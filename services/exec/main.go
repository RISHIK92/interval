// The execution engine (ARCH-1, ARCH-2, EXEC-1 to EXEC-5; ADR-0039 PROPOSED): runs
// untrusted code, one fresh sandbox per run. P5-W28-S01 gives one command for local
// checks; the queue consumer comes in W31-S01.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
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
	file := flags.String("file", "", "the source file")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	source, err := os.ReadFile(*file)
	if err != nil {
		return err
	}
	stdin, err := io.ReadAll(os.Stdin)
	if err != nil {
		return err
	}
	lang, ok := engine.Lookup(*language)
	if !ok {
		return fmt.Errorf("%w: %q", engine.ErrUnknownLanguage, *language)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	r := &engine.Runner{WorkDir: os.Getenv("EXEC_WORK_DIR"), Docker: "docker", Runtime: os.Getenv("EXEC_RUNTIME")}
	res, err := r.Run(ctx, engine.Job{
		Language: *language,
		Files:    map[string]string{lang.Main: string(source)},
		Stdin:    string(stdin),
		Limits:   defaults,
	})
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(res)
}
