use std::path::{Path, PathBuf};

pub fn sidecar_path(path: &Path) -> Option<PathBuf> {
    let mut name = path.file_name()?.to_os_string();
    match path.extension().and_then(|s| s.to_str()) {
        Some(ext) if ["dxf", "pdf", "png", "jpg", "jpeg"].iter().any(|known| ext.eq_ignore_ascii_case(known)) => {
            Some(path.with_extension("pdballoons.json"))
        }
        _ => {
            // A typed Save name may have dots before the .dxf extension is added.
            name.push(".pdballoons.json");
            Some(path.with_file_name(name))
        }
    }
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
            ("jobs/plate.v2", "jobs/plate.v2.pdballoons.json"),
            ("jobs/.dxf", "jobs/.dxf.pdballoons.json"),
            ("jobs/photo.PNG", "jobs/photo.pdballoons.json"),
            ("jobs/plate $& [1].dxf", "jobs/plate $& [1].pdballoons.json"),
        ] {
            assert_eq!(sidecar_path(Path::new(input)), Some(PathBuf::from(output)));
        }
        assert_eq!(sidecar_path(Path::new("/")), None);
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
