//! Name resolution that also works where the system resolver does not.
//!
//! The static musl binaries read `/etc/resolv.conf`, which Android/Termux does not have (it lives under
//! `$PREFIX/etc`), so every lookup failed there. The system resolver is always tried first; only when it
//! fails does this module ask public DNS servers over UDP (Cloudflare, then Google). That fallback sends
//! the host name being resolved (normally `4words.aletheia.land`) to those servers; set
//! `FOURWORDS_NO_DNS_FALLBACK=1` to disable it.

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;
use tokio::net::UdpSocket;

const SERVERS: [&str; 3] = ["1.1.1.1:53", "8.8.8.8:53", "9.9.9.9:53"];
const TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Default)]
pub struct Resolver;

impl Resolve for Resolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs = lookup(&host).await;
            if addrs.is_empty() {
                return Err(format!("failed to resolve {host}").into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

async fn lookup(host: &str) -> Vec<SocketAddr> {
    if host.eq_ignore_ascii_case("localhost") {
        return vec![SocketAddr::new(Ipv4Addr::LOCALHOST.into(), 0), SocketAddr::new(Ipv6Addr::LOCALHOST.into(), 0)];
    }
    if let Ok(found) = tokio::net::lookup_host((host, 0)).await {
        let found: Vec<SocketAddr> = found.collect();
        if !found.is_empty() {
            return found;
        }
    }
    if std::env::var("FOURWORDS_NO_DNS_FALLBACK").as_deref() == Ok("1") {
        return Vec::new();
    }
    let mut out: Vec<SocketAddr> = Vec::new();
    for ty in [TYPE_A, TYPE_AAAA] {
        for server in SERVERS {
            if let Some(ips) = query(server, host, ty).await
                && !ips.is_empty()
            {
                out.extend(ips.into_iter().map(|ip| SocketAddr::new(ip, 0)));
                break;
            }
        }
    }
    out
}

const TYPE_A: u16 = 1;
const TYPE_AAAA: u16 = 28;

async fn query(server: &str, host: &str, ty: u16) -> Option<Vec<IpAddr>> {
    let mut id = [0u8; 2];
    getrandom::fill(&mut id).ok()?;
    let id = u16::from_be_bytes(id);
    let packet = encode_query(id, host, ty)?;
    let socket = UdpSocket::bind("0.0.0.0:0").await.ok()?;
    socket.connect(server).await.ok()?;
    socket.send(&packet).await.ok()?;
    let mut buf = [0u8; 1500];
    let n = tokio::time::timeout(TIMEOUT, socket.recv(&mut buf)).await.ok()?.ok()?;
    parse_response(&buf[..n], id)
}

fn encode_query(id: u16, host: &str, ty: u16) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(32 + host.len());
    out.extend_from_slice(&id.to_be_bytes());
    out.extend_from_slice(&[0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]); // recursion desired, one question
    for label in host.trim_end_matches('.').split('.') {
        if label.is_empty() || label.len() > 63 || !label.is_ascii() {
            return None;
        }
        out.push(label.len() as u8);
        out.extend_from_slice(label.as_bytes());
    }
    out.push(0);
    out.extend_from_slice(&ty.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes()); // class IN
    Some(out)
}

/// Skips a (possibly compressed) name starting at `pos`; returns the offset after it.
fn skip_name(buf: &[u8], mut pos: usize) -> Option<usize> {
    loop {
        let len = *buf.get(pos)? as usize;
        if len == 0 {
            return Some(pos + 1);
        }
        if len & 0xC0 == 0xC0 {
            buf.get(pos + 1)?;
            return Some(pos + 2);
        }
        pos += 1 + len;
    }
}

fn parse_response(buf: &[u8], id: u16) -> Option<Vec<IpAddr>> {
    if buf.len() < 12 || u16::from_be_bytes([buf[0], buf[1]]) != id || buf[2] & 0x80 == 0 || buf[3] & 0x0F != 0 {
        return None;
    }
    let questions = u16::from_be_bytes([buf[4], buf[5]]) as usize;
    let answers = u16::from_be_bytes([buf[6], buf[7]]) as usize;
    let mut pos = 12;
    for _ in 0..questions {
        pos = skip_name(buf, pos)? + 4;
    }
    let mut out = Vec::new();
    for _ in 0..answers {
        pos = skip_name(buf, pos)?;
        let header = buf.get(pos..pos + 10)?;
        let ty = u16::from_be_bytes([header[0], header[1]]);
        let rdlen = u16::from_be_bytes([header[8], header[9]]) as usize;
        pos += 10;
        let data = buf.get(pos..pos + rdlen)?;
        pos += rdlen;
        match (ty, rdlen) {
            (TYPE_A, 4) => out.push(IpAddr::V4(Ipv4Addr::new(data[0], data[1], data[2], data[3]))),
            (TYPE_AAAA, 16) => {
                let mut octets = [0u8; 16];
                octets.copy_from_slice(data);
                out.push(IpAddr::V6(Ipv6Addr::from(octets)));
            }
            _ => {} // CNAME and others: the resolver already followed them and returned the addresses
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_question() {
        let q = encode_query(0xBEEF, "4words.aletheia.land", TYPE_A).unwrap();
        assert_eq!(&q[..4], &[0xBE, 0xEF, 0x01, 0x00]);
        assert_eq!(q[12], 6); // "4words"
        assert_eq!(&q[q.len() - 4..], &[0, 1, 0, 1]);
        assert!(encode_query(1, "bad..host", TYPE_A).is_none());
    }

    #[test]
    fn parses_a_compressed_answer_with_a_cname_first() {
        let q = encode_query(7, "a.b", TYPE_A).unwrap();
        let mut r = q.clone();
        r[2] = 0x81;
        r[3] = 0x80; // response, recursion available, rcode 0
        r[7] = 2; // two answers
        // CNAME answer (ignored), name pointer to offset 12
        r.extend_from_slice(&[0xC0, 12, 0, 5, 0, 1, 0, 0, 0, 60, 0, 2, 0xC0, 12]);
        // A answer 203.0.113.9
        r.extend_from_slice(&[0xC0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 203, 0, 113, 9]);
        assert_eq!(parse_response(&r, 7), Some(vec![IpAddr::V4(Ipv4Addr::new(203, 0, 113, 9))]));
        assert_eq!(parse_response(&r, 8), None, "a different transaction id is rejected");
    }

    #[test]
    fn rejects_error_and_truncated_replies() {
        let q = encode_query(1, "a.b", TYPE_A).unwrap();
        let mut nx = q.clone();
        nx[2] = 0x81;
        nx[3] = 0x83; // NXDOMAIN
        assert_eq!(parse_response(&nx, 1), None);
        assert_eq!(parse_response(&q[..8], 1), None);
        let mut cut = q.clone();
        cut[2] = 0x81;
        cut[3] = 0x80;
        cut[7] = 1; // claims an answer that is not there
        assert_eq!(parse_response(&cut, 1), None);
    }

    #[tokio::test]
    async fn localhost_never_needs_a_resolver() {
        let found = lookup("localhost").await;
        assert!(found.iter().any(|a| a.ip().is_loopback()));
    }
}
