fn main() {
    use std::{env, fs, path::PathBuf};

    println!("cargo:rustc-check-cfg=cfg(dwg_helper)");
    println!("cargo:rerun-if-changed=dwg2dxf");
    let helper = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("dwg2dxf");
    if helper.join("dwg2dxf.exe").is_file() {
        for name in ["dxf2dwg.exe", "COPYING", "SOURCE.txt"] {
            assert!(helper.join(name).is_file(), "DWG payload missing {name}");
        }
        let source = fs::read_to_string(helper.join("SOURCE.txt")).expect("DWG source note");
        let commit = source.lines().find_map(|line| line.strip_prefix("Commit: "))
            .expect("DWG source commit");
        assert!(commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit()), "DWG commit SHA");
        let mut files = fs::read_dir(&helper).unwrap()
            .map(|entry| entry.unwrap().path()).filter(|path| path.is_file()).collect::<Vec<_>>();
        files.sort();
        let mut generated = format!("pub(super) const COMMIT: &str = {commit:?};\npub(super) const FILES: &[(&str, &[u8])] = &[\n");
        for path in files {
            generated.push_str(&format!("({:?}, include_bytes!({:?})),\n", path.file_name().unwrap().to_str().unwrap(), path));
        }
        generated.push_str("];\n");
        fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("dwg_files.rs"), generated).unwrap();
        println!("cargo:rustc-cfg=dwg_helper");
    }
    tauri_build::build()
}
