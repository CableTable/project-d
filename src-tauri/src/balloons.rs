use std::path::{Path, PathBuf};

pub fn sidecar_path(path: &Path) -> Option<PathBuf> {
    path.file_name()?;
    match path.extension().and_then(|s| s.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("dxf") || ext.eq_ignore_ascii_case("pdf") => {}
        None => {} // Save dialogs may return a name before the .dxf extension is added.
        _ => return None,
    }
    Some(path.with_extension("pdballoons.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_matching_sidecar_is_granted() {
        for (input, output) in [
            ("jobs.v2/a.b.DXF", "jobs.v2/a.b.pdballoons.json"),
            ("jobs/inspection.pdf", "jobs/inspection.pdballoons.json"),
            ("jobs/noext", "jobs/noext.pdballoons.json"),
            ("jobs/plate $& [1].dxf", "jobs/plate $& [1].pdballoons.json"),
        ] {
            assert_eq!(sidecar_path(Path::new(input)), Some(PathBuf::from(output)));
        }
        for input in ["jobs/a.pdballoons.json", "jobs/arial.ttf", "jobs/aliases.pgp", "/"] {
            assert_eq!(sidecar_path(Path::new(input)), None);
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_prefix_and_folder_are_preserved() {
        for prefix in [r"C:\jobs", r"\\?\C:\jobs", r"\\server\share\jobs"] {
            assert_eq!(
                sidecar_path(Path::new(&format!(r"{}\a.b.DXF", prefix))),
                Some(PathBuf::from(format!(r"{}\a.b.pdballoons.json", prefix)))
            );
        }
    }
}
