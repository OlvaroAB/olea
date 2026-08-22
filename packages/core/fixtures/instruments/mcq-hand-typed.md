---
course: LITHO204
---

## Typed in a hurry, still a valid quiz item

Irregular spacing, a field order that is not the canonical one, mixed-case labels, a blank line in
the middle, and a tilde fence instead of a backtick one. All of it parses; none of it is tidied up
on read. Being read is not a reason to be reformatted, and a formatter that ran on parse would put
a byte-churning diff in every commit she makes.

~~~~olea-mcq
Stem :   Which igneous grain size says the magma cooled slowly?
distractor:   Aphanitic
answer:Phaneritic

distractor: Porphyritic
distractor:  Banded
DISTRACTOR: Foliated
   id: mcq-grain-size-1
~~~~

The canonical form of that same item is what `serializeMcq` emits, and it is deliberately not what
is written above.
