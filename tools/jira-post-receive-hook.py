#!/usr/bin/env python
# Copyright 2011 (c) Trent Mick.

"""A git post-receive hook to add a Jira ticket comment for the commit to
each referenced ticket in the commit message (this for each commit in
the push).

Requirements:
- Python >= 2.4 (not Python 3.x)
"""

__version__ = "1.0.0"

import os
import sys
import xmlrpclib
import re



#---- config

DRY_RUN = False
GIT = "git"

MO_URL = "https://mo.example.com"
JIRA_URL = "https://jira.example.com/"
JIRA_CREDENTIALS = "BOTUSER:BOTPASSWORD"
JIRA_PROJECTS = """
    PROJA PROJB
    """.split()

# The name (or whatever arbitrary string) used in post-receive output to
# indicate who to talk to about a hook error.
ADMIN = "your administrator"


TEMPLATE = """
{panel:borderColor=#ccc|borderStyle=solid|bgColor=#d3e1fe}
*[%(repo)s commit %(sha)s|%(mo_url)s%(repo)s/commit/%(sha)s]* *(**[branch %(branch)s|%(mo_url)s/%(repo)s/commits/%(branch)s]**, by %(author)s)*

%(message)s
{panel}
"""


#---- globals & errors

class Error(Exception):
    pass



#---- internal support routines

def printError(errmsg):
    lines = [
        "* * *",
        "* %s %s" % (sys.executable, ' '.join(sys.argv)),
        "*"
    ]
    lines += ["* "+s for s in errmsg.splitlines(False)]
    if ADMIN:
        lines.append("*")
        lines.append("* Please report this full error message to: %s" % ADMIN)
    lines.append("* * *")
    print('\n'.join(lines))

def run(argv):
    """Run the given cmd and return (stdout, stderr).
    Raise on non-zero retval.
    """
    from subprocess import Popen, PIPE
    p = Popen(argv, stdout=PIPE, stderr=PIPE, close_fds=True)
    p.wait()
    stdout = p.stdout.read()
    stderr = p.stderr.read()
    if p.returncode:
        raise Error("error (%d) running '%s'\n\n-- stdout:\n%s\n-- stderr:\n%s\n"
            % (p.returncode, ' '.join(argv), stdout, stderr))
    return (stdout, stderr)

def genCommits(startRev, endRev):
    """Generate commits (with commit info) for each commit from
    `startRev` (exclusive) to `endRev` (inclusive).
    """
    stdout, stderr = run([GIT, "log", "--pretty=medium",
        "%s..%s" % (startRev, endRev)])
    for commitStr in re.compile(r'^commit ', re.M).split(stdout):
        if not commitStr:
            continue
        sha, rest = commitStr.split(None, 1)
        author = rest.split('\n', 1)[0].split(': ', 1)[1].split('<', 1)[0].strip()
        meta, message = re.compile(r'^    ', re.M).split(rest, 1)
        yield {"sha": sha, "message": message, "author": author}

_jiraIssueRe = re.compile(r"\b((%s)-(\d+))\b" % '|'.join(JIRA_PROJECTS))
def genJiraIssues(commitInfo):
    for match in _jiraIssueRe.finditer(commitInfo["message"]):
        yield match.group(1)

_authTokenCache = None
def getAuthToken(server):
    global _authTokenCache
    if _authTokenCache is None:
        _authTokenCache = server.jira1.login(*JIRA_CREDENTIALS.split(':', 1))
    return _authTokenCache



#---- mainline

def main(argv=sys.argv):
    print "Adding commit info to referenced Jira tickets."

    if len(argv[1:]) != 3:
        raise Error("incorrect number of args: argv=%r" % argv)
    oldrev, newrev, refname = argv[1:]

    repo = os.path.basename(os.getcwd())
    if repo.endswith(".git"):
        repo = repo[:-len(".git")]
    branch = refname.split('/')[-1]

    server = xmlrpclib.ServerProxy(JIRA_URL + "/rpc/xmlrpc")
    for commitInfo in genCommits(oldrev, newrev):
        sha = commitInfo["sha"][:7]
        data = {
            "mo_url": MO_URL,
            "repo": repo,
            "sha": sha,
            "author": commitInfo["author"],
            "message": commitInfo["message"].rstrip(),
            "branch": branch
        }
        for jira in genJiraIssues(commitInfo):
            print "\t> %s (commit %s)" % (jira, sha)
            comment = TEMPLATE % data
            if not DRY_RUN:
                authToken = getAuthToken(server)
                server.jira1.addComment(authToken, jira, comment)

    #TODO: add a guard if too many?


if __name__ == "__main__":
    try:
        retval = main(sys.argv)
    except KeyboardInterrupt:
        sys.exit(1)
    except SystemExit:
        raise
    except:
        import traceback
        exc_info = sys.exc_info()
        if hasattr(exc_info[0], "__name__"):
            exc_class, exc, tb = exc_info
            tb_path, tb_lineno, tb_func = traceback.extract_tb(tb)[-1][:3]
            errmsg = "%s (%s:%s in %s)" % (exc, tb_path,
                tb_lineno, tb_func)
        else:  # string exception
            errmsg = exc_info[0]
        errmsg += "\n\n" + ''.join(traceback.format_exception(*exc_info))
        printError(errmsg)
        sys.exit(1)
    else:
        sys.exit(retval)
