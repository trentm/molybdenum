#!/usr/bin/env python

"""
Simple Pygments driver.

Pygments' command line `pygmentize` doesn't have a way to pass in content
and stdin *and* give a filename for lexer detection. This driver provides
that.

Usage:
    python pyg.py FILENAME      # use FILENAME for content and lexer type
    python pyg.py FILENAME -    # use FILENAME for lexer type, stdin for content
"""

from os.path import join, dirname, basename
import sys
import codecs

sys.path.insert(0, join(dirname(__file__), "pygments"))
from pygments import highlight
from pygments.lexers import get_lexer_for_filename, guess_lexer, TextLexer
from pygments.formatters import get_formatter_by_name
from pygments.util import ClassNotFound

args = sys.argv[1:]
if len(args) == 1:
    filename = args[0]
    content = codecs.open(args[0], 'r', 'utf-8').read()
elif len(args) == 2:
    filename = args[0]
    assert args[1] == "-"
    content = sys.stdin.read()

# Cheesy hack for override some false guesses by Pygments.
# A better answer might be to look at lexing errors and try a secondary
# guess.
overrides = {
    "Makefile.py": ".py",
}
basename = basename(filename)
try:
    lexer = get_lexer_for_filename(overrides.get(basename, filename), content)
except ClassNotFound:
    try:
        lexer = guess_lexer(content)
    except ClassNotFound:
        lexer = TextLexer()
sys.stderr.write("lexer: %r\n" % lexer)

fmter = get_formatter_by_name("html")
fmter.encoding = 'utf-8'
lexer.encoding = 'utf-8'
outfile = sys.stdout

highlight(content, lexer, fmter, outfile)


