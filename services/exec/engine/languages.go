package engine

// P5-W28-S01 (Q-P5-04): a language's image, pinned by digest, and how its code runs.
// Python first; the other four come in W28-S03.
type Language struct {
	Image string
	// The file the submission is written to, and the command that runs it.
	Main string
	Cmd  []string
}

var languages = map[string]Language{
	// The worker's own base (workers/jobs/Dockerfile), built 2026-10-21. -I and -S: no
	// user site, no PYTHON* variables, no current directory on the path.
	"python": {
		Image: "python:3.13.17-slim-bookworm@sha256:e32be0e55814a08977501ca863271d9bd02443710db8f2afaf8372e2c4508530",
		Main:  "main.py",
		Cmd:   []string{"python3", "-I", "-S", "/code/main.py"},
	},
}

// Lookup gives a language by name.
func Lookup(name string) (Language, bool) {
	l, ok := languages[name]
	return l, ok
}
