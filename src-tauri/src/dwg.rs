use std::path::Path;

pub const NOT_INCLUDED: &str = "DWG helper not in this build";

#[cfg(dwg_helper)]
mod embedded {
    include!(concat!(env!("OUT_DIR"), "/dwg_files.rs"));
}

/// The DXF as raw bytes: LibreDWG writes R2000-R2004 text in the file's code page, not UTF-8 (the web reader decodes with $DWGCODEPAGE).
pub fn convert(path: &Path) -> Result<Vec<u8>, String> {
    #[cfg(dwg_helper)]
    {
        use std::sync::Mutex;
        static EXTRACT: Mutex<()> = Mutex::new(());
        let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
        let folder = Path::new(&local).join("ProjectD").join(helper::folder_name(embedded::COMMIT));
        {
            let _guard = EXTRACT.lock().map_err(|error| error.to_string())?;
            helper::extract(&folder, embedded::FILES)?;
        }
        let temp = helper::TempFile::new("dxf").map_err(|error| error.to_string())?;
        helper::run(
            std::process::Command::new(folder.join("dwg2dxf.exe"))
                .args(["-y", "-o"]).arg(&temp.0).arg(path),
            std::time::Duration::from_secs(60),
        )?;
        std::fs::read(&temp.0).map_err(|error| error.to_string())
    }
    #[cfg(not(dwg_helper))]
    {
        let _ = path;
        Err(NOT_INCLUDED.into())
    }
}

/// A dropped .dwg has no path: its bytes go to a temp .dwg (removed on every path) and through `convert`.
pub fn convert_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(dwg_helper)]
    {
        let temp = helper::TempFile::new("dwg").map_err(|error| error.to_string())?;
        std::fs::write(&temp.0, bytes).map_err(|error| error.to_string())?;
        convert(&temp.0)
    }
    #[cfg(not(dwg_helper))]
    {
        let _ = bytes;
        Err(NOT_INCLUDED.into())
    }
}

#[cfg(any(dwg_helper, test))]
mod helper {
    use std::{
        fs::{self, OpenOptions},
        io::{self, BufRead, BufReader},
        path::{Path, PathBuf},
        process::{Child, Command, ExitStatus, Stdio},
        sync::atomic::{AtomicU64, Ordering},
        thread,
        time::{Duration, Instant},
    };

    pub fn folder_name(commit: &str) -> String {
        format!("dwg2dxf-{}", &commit[..12])
    }

    pub fn extract(folder: &Path, files: &[(&str, &[u8])]) -> Result<(), String> {
        fs::create_dir_all(folder).map_err(|error| error.to_string())?;
        for (name, bytes) in files {
            let path = folder.join(name);
            if fs::metadata(&path).map(|meta| meta.len() == bytes.len() as u64).unwrap_or(false) {
                continue;
            }
            fs::write(path, bytes).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub struct TempFile(pub PathBuf);

    impl TempFile {
        pub fn new(extension: &str) -> io::Result<Self> {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            loop {
                let path = std::env::temp_dir().join(format!("projectd-dwg-{}-{}.{extension}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
                match OpenOptions::new().write(true).create_new(true).open(&path) {
                    Ok(_) => return Ok(Self(path)),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error),
                }
            }
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    fn wait(child: &mut Child, timeout: Duration) -> Result<ExitStatus, String> {
        let start = Instant::now();
        loop {
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                return Ok(status);
            }
            if start.elapsed() >= timeout {
                return Err("DWG conversion timed out after 60 s".into());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn run(command: &mut Command, timeout: Duration) -> Result<(), String> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped())
            .spawn().map_err(|error| error.to_string())?;
        let stderr = child.stderr.take().unwrap();
        // Drain while running: a full stderr pipe must not stall conversion or its timeout.
        let reader = thread::spawn(move || {
            BufReader::new(stderr).lines().map_while(Result::ok)
                .map(|line| line.trim().to_owned()).filter(|line| !line.is_empty()).last()
        });
        let result = wait(&mut child, timeout);
        if result.is_err() {
            child.kill().map_err(|error| error.to_string())?;
            child.wait().map_err(|error| error.to_string())?;
        }
        let last_line = reader.join().map_err(|_| "Could not read DWG helper stderr")?;
        match result {
            Ok(status) if status.success() => Ok(()),
            Ok(status) => Err(last_line.unwrap_or_else(|| format!("DWG conversion failed ({status})"))),
            Err(error) => Err(error),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn versioned_folder_and_extraction() {
            assert_eq!(folder_name("0123456789abcdef0123456789abcdef01234567"), "dwg2dxf-0123456789ab");
            let temp = TempFile::new("dxf").unwrap();
            let folder = temp.0.with_extension("payload");
            let files: &[(&str, &[u8])] = &[("COPYING", b"licence"), ("SOURCE.txt", b"source")];
            extract(&folder, files).unwrap();
            let path = folder.join("COPYING");
            let modified = fs::metadata(&path).unwrap().modified().unwrap();
            extract(&folder, files).unwrap();
            assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), modified);
            fs::write(&path, b"changed").unwrap();
            extract(&folder, files).unwrap();
            assert_eq!(fs::read(&path).unwrap(), b"changed", "same size skips rewriting");
            fs::write(&path, b"part").unwrap();
            extract(&folder, files).unwrap();
            assert_eq!(fs::read(&path).unwrap(), b"licence");
            assert_eq!(fs::read(folder.join("SOURCE.txt")).unwrap(), b"source");
            fs::remove_dir_all(folder).unwrap();
            let path = temp.0.clone();
            drop(temp);
            assert!(!path.exists());
        }

        fn fake(mode: &str) -> Command {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", "dwg::helper::tests::fake_helper", "--nocapture"])
                .env("PROJECTD_DWG_FAKE", mode);
            command
        }

        #[test]
        fn fake_helper() {
            match std::env::var("PROJECTD_DWG_FAKE").as_deref() {
                Ok("timeout") => thread::sleep(Duration::from_secs(30)),
                Ok("failure") => {
                    for _ in 0..10000 { eprintln!("earlier diagnostic"); }
                    eprintln!("\n  final helper error  \n\n");
                    std::process::exit(7);
                }
                _ => (),
            }
        }

        #[test]
        fn command_success_and_last_nonempty_stderr() {
            assert_eq!(run(&mut fake("success"), Duration::from_secs(10)), Ok(()));
            assert_eq!(run(&mut fake("failure"), Duration::from_secs(10)), Err("final helper error".into()));
        }

        #[test]
        fn timeout_kills_and_reaps_the_child() {
            let mut child = fake("timeout").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
            assert_eq!(wait(&mut child, Duration::from_millis(20)), Err("DWG conversion timed out after 60 s".into()));
            child.kill().unwrap();
            assert!(!child.wait().unwrap().success());
            let start = Instant::now();
            assert_eq!(run(&mut fake("timeout"), Duration::from_millis(20)), Err("DWG conversion timed out after 60 s".into()));
            assert!(start.elapsed() < Duration::from_secs(5));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(dwg_helper))]
    #[test]
    fn missing_helper_is_an_actionable_error() {
        assert_eq!(convert(Path::new("missing.dwg")), Err("DWG helper not in this build".into()));
    }

    #[cfg(dwg_helper)]
    #[test]
    fn round_trip_embedded_helper() {
        let Some(input) = std::env::var_os("PROJECTD_DWG_ROUNDTRIP_INPUT") else { return; };
        let output = std::env::var_os("PROJECTD_DWG_ROUNDTRIP_OUTPUT").expect("round-trip output path");
        let bytes = convert(Path::new(&input)).expect("embedded DWG helper conversion");
        let from_bytes = convert_bytes(&std::fs::read(&input).unwrap()).expect("embedded DWG helper conversion from bytes");
        assert_eq!(from_bytes, bytes, "a dropped .dwg converts like the same file opened by path");
        std::fs::write(output, bytes).unwrap();
    }
}
