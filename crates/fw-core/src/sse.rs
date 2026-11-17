//! Minimal Server-Sent Events parser (used for MCP SSE responses and room streams).

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub id: Option<String>,
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    buffer: Vec<u8>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds bytes and returns every complete event (blank-line terminated).
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some((end, sep_len)) = find_separator(&self.buffer) {
            let block: Vec<u8> = self.buffer.drain(..end + sep_len).collect();
            if let Some(event) = parse_block(&block[..end]) {
                events.push(event);
            }
        }
        events
    }

    /// Flushes a trailing event that was not blank-line terminated (stream ended).
    pub fn finish(&mut self) -> Option<SseEvent> {
        if self.buffer.is_empty() {
            return None;
        }
        let block = std::mem::take(&mut self.buffer);
        parse_block(&block)
    }
}

fn find_separator(buf: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i < buf.len() {
        if buf[i..].starts_with(b"\r\n\r\n") {
            return Some((i, 4));
        }
        if buf[i..].starts_with(b"\n\n") {
            return Some((i, 2));
        }
        if buf[i..].starts_with(b"\r\r") {
            return Some((i, 2));
        }
        i += 1;
    }
    None
}

fn parse_block(block: &[u8]) -> Option<SseEvent> {
    let text = String::from_utf8_lossy(block);
    let mut event = SseEvent::default();
    let mut has_data = false;
    for line in text.split(['\n', '\r']) {
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => event.event = Some(value.to_string()),
            "id" => event.id = Some(value.to_string()),
            "data" => {
                if has_data {
                    event.data.push('\n');
                }
                event.data.push_str(value);
                has_data = true;
            }
            _ => {}
        }
    }
    (has_data || event.event.is_some()).then_some(event)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_split_chunks_comments_and_multiline_data() {
        let mut p = SseParser::new();
        // The comment-only block yields nothing; the msg event arrives split across two chunks.
        assert!(p.push(b":keepalive\r\n\r\nevent: msg\nid: 3\nda").is_empty());
        let all = p.push(b"ta: {\"a\":1}\ndata: more\n\nevent: presence\ndata: {}\n\n");
        assert_eq!(all[0].event.as_deref(), Some("msg"));
        assert_eq!(all[0].id.as_deref(), Some("3"));
        assert_eq!(all[0].data, "{\"a\":1}\nmore");
        assert_eq!(all[1].event.as_deref(), Some("presence"));
    }

    #[test]
    fn finish_flushes_unterminated_event() {
        let mut p = SseParser::new();
        assert!(p.push(b"data: tail").is_empty());
        assert_eq!(p.finish().unwrap().data, "tail");
    }
}
