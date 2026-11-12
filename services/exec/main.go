// The execution engine (ARCH-1, ARCH-2, EXEC-1 to EXEC-5; ADR-0039 PROPOSED): runs
// untrusted code, one fresh sandbox per run. P5-W28-S01 gives one command for local
// checks; the queue consumer comes in W31-S01.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"

	"interval/services/exec/engine"
)

// What a run gets unless told otherwise; problems set their own from W30.
var defaults = engine.Limits{MemoryMB: 256, CPUs: 1, Pids: 64, TmpMB: 64, Seconds: 10, OutputKB: 1024}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "exec:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 || args[0] != "run" {
		return fmt.Errorf("usage: exec run --language L --file F < stdin")
	}
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	language := flags.String("language", "python", "the submission's language: "+strings.Join(engine.Names(), ", "))
	file := flags.String("file", "", "the source file (the language's main file)")
	dir := flags.String("dir", "", "or a directory: every file in it, the harness's main file among them")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if _, ok := engine.Lookup(*language); !ok {
		return fmt.Errorf("%w: %q", engine.ErrUnknownLanguage, *language)
	}
	files, err := readFiles(*file, *dir, *language)
	if err != nil {
		return err
	}
	stdin, err := io.ReadAll(os.Stdin)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	r := &engine.Runner{WorkDir: os.Getenv("EXEC_WORK_DIR"), Docker: "docker", Runtime: os.Getenv("EXEC_RUNTIME")}
	res, err := r.Run(ctx, engine.Job{
		Language: *language,
		Files:    files,
		Stdin:    string(stdin),
		Limits:   defaults,
	})
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(res)
}

// One file as the language's main file, or every regular file in a directory (a
// harness and a submission, P5-W29-S02).
func readFiles(file, dir, language string) (map[string]string, error) {
	if (file == "") == (dir == "") {
		return nil, errors.New("give --file or --dir")
	}
	if file != "" {
		lang, _ := engine.Lookup(language)
		source, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		return map[string]string{lang.Main: string(source)}, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	files := map[string]string{}
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		files[e.Name()] = string(body)
	}
	return files, nil
}
