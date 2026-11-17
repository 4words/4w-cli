//! Argument parsing with the same strict semantics as Node's `util.parseArgs`
//! (so the Rust CLI accepts and rejects exactly what the TypeScript CLI did).

use fw_core::lang::trs;
use fw_core::{Error, Result};
use std::collections::HashMap;

#[derive(Clone, Copy)]
pub struct Opt {
    pub name: &'static str,
    pub short: Option<char>,
    pub value: bool,
}

pub const fn flag(name: &'static str) -> Opt {
    Opt { name, short: None, value: false }
}
pub const fn string(name: &'static str) -> Opt {
    Opt { name, short: None, value: true }
}
pub const fn string_short(name: &'static str, short: char) -> Opt {
    Opt { name, short: Some(short), value: true }
}

#[derive(Debug, Default)]
pub struct Parsed {
    values: HashMap<String, String>,
    flags: HashMap<String, bool>,
    pub positionals: Vec<String>,
}

impl Parsed {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }
    pub fn flag(&self, name: &str) -> bool {
        self.flags.get(name).copied().unwrap_or(false)
    }
    pub fn has(&self, name: &str) -> bool {
        self.flags.contains_key(name) || self.values.contains_key(name)
    }
}

pub fn parse(args: &[String], spec: &[Opt]) -> Result<Parsed> {
    let mut out = Parsed::default();
    let find_long = |name: &str| spec.iter().find(|o| o.name == name);
    let find_short = |c: char| spec.iter().find(|o| o.short == Some(c));
    let unknown = |token: &str| {
        Error::usage(trs(
            format!(
                "Unknown option '{token}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', e.g. '-- {token}'."
            ),
            format!(
                "Opção desconhecida '{token}'. Para passar um argumento posicional iniciado por '-', coloque-o no final do comando após '--', por exemplo '-- {token}'."
            ),
            format!(
                "Opción desconocida '{token}'. Para pasar un argumento posicional que empiece por '-', colóquelo al final del comando tras '--', por ejemplo '-- {token}'."
            ),
        ))
    };
    let missing = |token: &str| {
        Error::usage(trs(
            format!("Option '{token} <value>' argument missing."),
            format!("Falta o valor da opção '{token} <valor>'."),
            format!("Falta el valor de la opción '{token} <valor>'."),
        ))
    };
    let mut i = 0;
    while i < args.len() {
        let token = &args[i];
        if token == "--" {
            out.positionals.extend(args[i + 1..].iter().cloned());
            break;
        }
        if let Some(rest) = token.strip_prefix("--") {
            let (name, inline) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (rest, None),
            };
            let opt = find_long(name).ok_or_else(|| unknown(token))?;
            if opt.value {
                let value = match inline {
                    Some(v) => v,
                    None => {
                        i += 1;
                        match args.get(i) {
                            Some(v) if !(v.starts_with('-') && v.len() > 1) => v.clone(),
                            _ => return Err(missing(&format!("--{name}"))),
                        }
                    }
                };
                out.values.insert(opt.name.to_string(), value);
            } else {
                if inline.is_some() {
                    return Err(Error::usage(trs(
                        format!("Option '--{name}' does not take an argument."),
                        format!("A opção '--{name}' não aceita argumento."),
                        format!("La opción '--{name}' no admite argumento."),
                    )));
                }
                out.flags.insert(opt.name.to_string(), true);
            }
        } else if token.len() > 1 && token.starts_with('-') {
            let mut chars = token[1..].chars();
            let c = chars.next().unwrap_or('-');
            let opt = find_short(c).ok_or_else(|| unknown(token))?;
            let tail: String = chars.collect();
            if opt.value {
                let value = if !tail.is_empty() {
                    tail
                } else {
                    i += 1;
                    match args.get(i) {
                        Some(v) if !(v.starts_with('-') && v.len() > 1) => v.clone(),
                        _ => return Err(missing(&format!("-{c}"))),
                    }
                };
                out.values.insert(opt.name.to_string(), value);
            } else if tail.is_empty() {
                out.flags.insert(opt.name.to_string(), true);
            } else {
                return Err(unknown(token));
            }
        } else {
            out.positionals.push(token.clone());
        }
        i += 1;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_flags_values_short_and_double_dash() {
        let spec = [flag("raw"), string("key"), string_short("output", 'o')];
        let p = parse(&a(&["x", "--raw", "--key=abc", "-o", "f.txt", "--", "-y"]), &spec).unwrap();
        assert!(p.flag("raw"));
        assert_eq!(p.get("key"), Some("abc"));
        assert_eq!(p.get("output"), Some("f.txt"));
        assert_eq!(p.positionals, a(&["x", "-y"]));
    }

    #[test]
    fn rejects_unknown_missing_and_valued_flags() {
        let spec = [flag("raw"), string("key")];
        assert!(parse(&a(&["--nope"]), &spec).is_err());
        assert!(parse(&a(&["--key"]), &spec).is_err());
        assert!(parse(&a(&["--key", "--raw"]), &spec).is_err());
        assert!(parse(&a(&["--raw=1"]), &spec).is_err());
        assert!(parse(&a(&["-z"]), &spec).is_err());
    }
}
