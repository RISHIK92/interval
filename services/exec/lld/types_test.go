package lld

import "testing"

// P5-W29-S01 (EXEC-4): result lines are the sandbox's output, untrusted; the generated
// Decode refuses anything outside the contract before the checker reads it.
func TestDecodeResultLineHoldsTheContract(t *testing.T) {
	good := []string{
		`{"call":0,"value":null}`,
		`{"call":2,"value":{"ana":1}}`,
		`{"call":1,"error":"IndexError: out of range"}`,
	}
	for _, s := range good {
		if _, err := DecodeResultLine([]byte(s)); err != nil {
			t.Errorf("%s: %v", s, err)
		}
	}
	bad := []string{
		`{"value":1}`,                              // no call
		`{"call":1}`,                               // neither
		`{"call":1,"value":1,"error":"x"}`,         // both
		`{"call":1,"value":1,"extra":true}`,        // unknown key
		`{"call":-1,"value":1}`,                    // negative
		`{"call":1,"error":"é"}`,                   // not printable ASCII
		`{"call":1,"value":1}{"call":2,"value":1}`, // two values
	}
	long := `{"call":1,"error":"`
	for range 201 {
		long += "x"
	}
	bad = append(bad, long+`"}`)
	for _, s := range bad {
		if _, err := DecodeResultLine([]byte(s)); err == nil {
			t.Errorf("accepted %.60s", s)
		}
	}
}

func TestDecodeScenarioHoldsTheContract(t *testing.T) {
	if _, err := DecodeScenario([]byte(`{"calls":[{"method":"new","args":[3]},{"method":"reset","args":[]}]}`)); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{
		`{"calls":[]}`,
		`{"calls":[{"method":"new"}]}`,
		`{"calls":[{"method":"","args":[]}]}`,
		`{"calls":[{"method":"new","args":[1,2,3,4,5,6,7,8,9]}]}`,
		`{"calls":[{"method":"new","args":[],"x":1}]}`,
	} {
		if _, err := DecodeScenario([]byte(s)); err == nil {
			t.Errorf("accepted %s", s)
		}
	}
}
