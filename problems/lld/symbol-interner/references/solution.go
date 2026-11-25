package main

// The flyweight: one immutable record per distinct text, shared by every occurrence. Its
// fields are unexported and nothing writes them after it's made.
type siSymbol struct {
	id   int64
	text string
}

// The flyweight factory: hands out the one shared symbol for a text, making it only the
// first time the text is seen.
type Interner struct {
	byText map[string]*siSymbol
	byId   []*siSymbol
	saved  int64
}

func NewInterner() *Interner {
	return &Interner{byText: map[string]*siSymbol{}}
}

func (in *Interner) intern(text string) int64 {
	if text == "" {
		panic("empty text")
	}
	if shared, ok := in.byText[text]; ok {
		in.saved += int64(len(text))
		return shared.id
	}
	symbol := &siSymbol{id: int64(len(in.byId)), text: text}
	in.byText[text] = symbol
	in.byId = append(in.byId, symbol)
	return symbol.id
}

func (in *Interner) lookup(id int64) string {
	if id < 0 || id >= int64(len(in.byId)) {
		panic("unknown id")
	}
	return in.byId[id].text
}

func (in *Interner) size() int64 {
	return int64(len(in.byId))
}

func (in *Interner) bytesSaved() int64 {
	return in.saved
}
