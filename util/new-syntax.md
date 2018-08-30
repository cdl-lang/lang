# New syntax for CDL

## Files

A file ending in `.cdl` may consist of

1. include lines, which include a class file or a foreign file. They are of the
form `%%directive%%: file path`. The file path can be placed between angular
brackets, e.g. <events.js>, for files included from the system directories, or
between double quotes, e.g. "./myclasses.cdl", using an absolute path or a
relative path. The two allowed directives are include and classfile. Note that
class definitions in an include file are not used.

2. JavaScript-style variable declaration: `var identifier = value;`. The value is parsed as a cdl value (see below).

3. JavaScript-style assignment: `identifier = value;`, `identifier.identifier = value;`, etc. This can be used to alter preceding or included declarations, or modify the value of initGlobalDefaults. The value is parsed as a cdl value (see below).

Class definitions are written as

    var classes = {
        Class1: ...,
        Class2: ...
    };

The screen area (of which there should only be one in each application), is also written as a JavaScript variable

    var screenArea = {
        ...
    };

## CDL code

Classes and the screenArea are variants, and a variant is an ordered set of (AV) values. Nothing changed.

### Attribute value

- no quotes needed around the class attribute,
- ^, * and # don't require quotes (unless the attribute is not an identifier).
- quotes around class names following the `class:` attribute are optional; quotes are still required when specifying class names elsewhere, e.g in function calls to areaOfClass.

### Expressions

- A function definition consists of an ordered set of identifiers, followed by the => symbol and the expression, e.g. o(a, b) => sqrt(a ** 2 + b ** 2). When there is only one identifier, the o() can be dropped. The identifiers in the parameter list and in the expression are replaced by strings for backward compatibility.

- A conditional consists of the query expression, followed by a question mark, followed by one or more alternatives, separated with pipe/or symbols. Each alternative consists of a match expression and a result expression: `query? match1: result1 | match2: result2 | ...`. E.g., `a > b? true: a | false: b`.

- The following binary operators are allowed, in order of priority: || (or); && (and); ==, !=, <, >, <=, >= (equal, notEqual, etc.); + (plus), - (minus); * (mult), / (div), % (modulo); ** (power). Unary operators - (uminus) and ! (not) are also allowed. In order to break priority or associativity, normal parenthesis can be used: `(1 + 2) * 3` translates to `[mult, [plus, 1, 2], 3]`.

- A simple projection, `[{attr: _}, expr]`, can be written as `expr.attr`. Multiple projections can be concatenated: `expr.a.b.c`.

- A function call can be written as `f(a1, a2, ...)`. This is rewritten to `[f, a1, a2, ...]`. As a consequence, queries can be written in the same style, e.g. `{a: 1}(list)`, but this is not recommended.

- Single identifiers:

  - Most identifiers refer to the local context label with that name, i.e. `id` is identical to `[{id: _}, [me]]`.
  - When an identifier `f` is used as a function, i.e. in `f(...)` or `[f, ...]`, predefined function names are not translated to local context label, so `last(first)` translates to `[last, [{first: _}, [me]]]`. This keeps the syntax backwards compatible.
  - If the identifier is one of a short list of functions that do not require arguments, and can be considered "constant-ish", it refers to that function rather than the local context label of that. E.g., `me` translate to `[me]`. This goes for identifiers: embedded, embeddedStar, embedding, embeddingStar, expressionOf, me, message, myMessage, and referredOf. This allows expressions such as `embedding.attr`.
  - Predefined symbols are left alone: true, false, Infinity, mustBeDefined ascending, descending, null, unmatched. They are forbidden as functions or as value for a simple projection, i.e. `null(x)` and `true.attr` are not allowed.

- JavaScript variables can be referred to by prefixing the name with two colons (the C++ symbol for global namespace): `::identifier`, which is useful when the environment defines frequently used expressions, e.g. for events. E.g.,

```
    var myClickEvent = [{ type: "MouseUp", subType: "Click"}, [myMessage]];
    ...

    ClassX:
        ...
        upon: ::myClickEvent
```
