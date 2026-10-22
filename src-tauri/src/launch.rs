use std::path::{Path, PathBuf};

pub fn file_paths(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .map(|arg| cwd.join(arg))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_executable_and_flags_but_keeps_all_file_types_and_missing_paths() {
        let cwd = std::env::current_dir().unwrap();
        let absolute = cwd.join("absolute.pdf");
        let args = vec![
            "ProjectD.exe".into(), "--debug".into(), "-x".into(), "".into(),
            "plate with spaces.DXF".into(), absolute.to_str().unwrap().into(),
            "missing.dwg".into(), "unsupported.xyz".into(),
        ];
        assert_eq!(file_paths(args, &cwd), vec![
            cwd.join("plate with spaces.DXF"), absolute,
            cwd.join("missing.dwg"), cwd.join("unsupported.xyz"),
        ]);
        assert!(file_paths(vec!["ProjectD.exe".into()], &cwd).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn preserves_drive_and_unc_paths() {
        let args = [r"C:\ProjectD.exe", r"D:\jobs\a.dxf", r"\\server\share\b.pdf"];
        assert_eq!(
            file_paths(args.map(String::from), Path::new(r"C:\work")),
            vec![PathBuf::from(args[1]), PathBuf::from(args[2])],
        );
    }
}
