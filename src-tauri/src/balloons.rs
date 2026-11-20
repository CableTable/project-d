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

/// The Ctrl+S backup beside the file: `Backup_of_<file name>`, the same rule as `backupPath` in web/doc.js.
pub fn backup_path(path: &Path) -> Option<PathBuf> {
    let mut name = std::ffi::OsString::from("Backup_of_");
    name.push(path.file_name()?);
    Some(path.with_file_name(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_backup_name_beside_the_file_is_granted() {
        for (input, output) in [
            ("D:/jobs/part.dwg.dxf", "D:/jobs/Backup_of_part.dwg.dxf"),
            ("part.dxf", "Backup_of_part.dxf"),
            ("Backup_of_part.dxf", "Backup_of_Backup_of_part.dxf"),
            ("jobs/panel $&.DXF", "jobs/Backup_of_panel $&.DXF"),
        ] {
            assert_eq!(backup_path(Path::new(input)), Some(PathBuf::from(output)));
        }
        assert_eq!(backup_path(Path::new("/")), None);
    }

    #[cfg(windows)]
    #[test]
    fn windows_backup_keeps_the_folder() {
        assert_eq!(backup_path(Path::new(r"C:\work\part.dxf")), Some(PathBuf::from(r"C:\work\Backup_of_part.dxf")));
        assert_eq!(backup_path(Path::new(r"C:/mixed\panel $&.DXF")), Some(PathBuf::from(r"C:/mixed\Backup_of_panel $&.DXF")));
    }

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
