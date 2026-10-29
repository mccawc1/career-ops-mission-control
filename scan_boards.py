#!/usr/bin/env python3
"""Scan company job boards for new remote matches that are not on the board yet.

    python3 scan_boards.py            # JSON list of candidates on stdout
    python3 scan_boards.py --check    # also report queued/Evaluated jobs whose posting is gone

Sources: every Greenhouse, Lever, Ashby and SmartRecruiters board in the
platforms collection, plus a fixed list of field-service, construction and
fleet software companies, plus RemoteOK and Remotive. Filters follow
targeting/remote-only: US remote, above the pay floor when a top of range is posted, no
commission-only, title in Chris's lanes. Vetting and cards are done by the
caller (a person or the scheduled Claude task), not here.
"""
import concurrent.futures as cf
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

DB = Path(__file__).with_name("data") / "db.json"

EXTRA = {
    "greenhouse": "samsara latitude gomotive fleetio billtrust servicetrade procoretechnologies buildops hover jobnimbus roofr openspace getbuilt fieldwire granum housecall smartsheet vixxo",
    "ashby": "jobber companycam angi thumbtack rilla raken workiz knowify hatch maintainx limble aurorasolar",
    "lever": "workwave lessen sitetracker yardzen servicechannel upkeep",
    "smartrecruiters": "ServiceTitan Xplor Procore",
}
API = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true",
    "lever": "https://api.lever.co/v0/postings/{}?mode=json",
    "smartrecruiters": "https://api.smartrecruiters.com/v1/companies/{}/postings?limit=100",
}
LANES = re.compile(r"onboard|implement|customer success|client success|account manag|project coordinat|project manag|program manag|solutions consult|vendor|partner success|customer experience|estimat|enablement|deployment|success manager|field operations|training specialist|trainer", re.I)
SKIP = re.compile(r"software engineer|engineering|developer|director|\bvp\b|vice president|head of|principal|data scien|account executive|sdr|bdr|recruit|intern|designer|counsel|sales development|business development|marketing|finance|payroll|accountant|warehouse|technician|driver|mechanic|ai trainer|tutor|annotat|staff|chief|product manager|security|legal|french|spanish|bilingual|german|japanese", re.I)
NON_US = re.compile(r"canada|uk\b|united kingdom|london|toronto|australia|india|emea|germany|poland|mexico|brazil|philippines|europe|ireland|apac|latam|ontario|spain|france|netherlands|belgium|austria|singapore|argentina|colombia|pakistan|monterrey", re.I)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def board(src):
    kind, name = src.split(":", 1)
    try:
        j = get(API[kind].format(name))
    except Exception:
        return []
    out = []
    if kind == "greenhouse":
        for x in j.get("jobs", []):
            out.append(dict(co=name, title=x["title"], loc=(x.get("location") or {}).get("name", ""), url=x["absolute_url"], body=x.get("content", "")))
    elif kind == "ashby":
        for x in j.get("jobs", []):
            loc = (x.get("location") or "") + (" REMOTE" if x.get("isRemote") else "") + " " + str(x.get("workplaceType", ""))
            out.append(dict(co=name, title=x["title"], loc=loc, url=x.get("jobUrl", ""), body=(x.get("descriptionPlain") or "") + " " + json.dumps(x.get("compensation", ""))))
    elif kind == "lever":
        for x in j if isinstance(j, list) else []:
            out.append(dict(co=name, title=x["text"], loc=x.get("categories", {}).get("location", "") + " " + str(x.get("workplaceType", "")), url=x["hostedUrl"], body=x.get("descriptionPlain", "") + " " + json.dumps(x.get("salaryRange", ""))))
    else:
        for x in j.get("content", []):
            out.append(dict(co=name, title=x["name"], loc=json.dumps(x.get("location", {})), url=f"https://jobs.smartrecruiters.com/{name}/{x['id']}", body=""))
    return out


def aggregators():
    out = []
    for q in ["customer success", "implementation", "onboarding", "project coordinator", "construction", "field service"]:
        try:
            for x in get("https://remotive.com/api/remote-jobs?search=" + urllib.parse.quote(q)).get("jobs", []):
                out.append(dict(co=x["company_name"], title=x["title"], loc=x.get("candidate_required_location", "") + " REMOTE", url=x["url"], body=x.get("description", "") + " " + x.get("salary", "")))
        except Exception:
            pass
    try:
        for x in get("https://remoteok.com/api")[1:]:
            out.append(dict(co=x.get("company", ""), title=x.get("position", ""), loc=(x.get("location") or "") + " REMOTE", url=x.get("url", ""), body=x.get("description", "") + f" ${x.get('salary_min', 0)} ${x.get('salary_max', 0)}"))
    except Exception:
        pass
    return out


def job_id(url):
    ids = re.findall(r"[0-9a-f]{8}-[0-9a-f-]{27}|\d{7,}", url)
    return ids[-1] if ids else url


def main():
    docs = json.loads(DB.read_text())["docs"]
    apps = [v["data"] for k, v in docs.items() if k.startswith("applications/")]
    have = {job_id(a.get("url", "")) for a in apps}
    srcs = {f"{k}:{n}" for k, names in EXTRA.items() for n in names.split()}
    for k, v in docs.items():
        if k.startswith("platforms/"):
            u = v["data"].get("url", "")
            for pat, kind in [(r"greenhouse\.io/([\w-]+)", "greenhouse"), (r"ashbyhq\.com/([\w-]+)", "ashby"), (r"lever\.co/([\w-]+)", "lever"), (r"smartrecruiters\.com/([\w-]+)", "smartrecruiters")]:
                m = re.search(pat, u)
                if m:
                    srcs.add(f"{kind}:{m.group(1)}")
    with cf.ThreadPoolExecutor(24) as ex:
        jobs = [j for js in ex.map(board, sorted(srcs)) for j in js] + aggregators()
    live = {job_id(j["url"]) for j in jobs}

    seen, picks = set(), []
    for j in jobs:
        t, loc = j["title"] or "", j["loc"] or ""
        body = re.sub(r"<[^>]+>", " ", html.unescape(html.unescape(j.get("body") or "")))
        if not LANES.search(t) or SKIP.search(t) or job_id(j["url"]) in have:
            continue
        if not re.search(r"remote", loc + " " + t, re.I) or (re.search(r"hybrid|onsite|on-site", loc, re.I) and "REMOTE Remote" not in loc):
            continue
        if NON_US.search(loc) and not re.search(r"\bus\b|usa|united states|americas|worldwide|anywhere", loc, re.I):
            continue
        pay = [int(re.sub(r"\D", "", p)) * (1000 if p.lower().endswith("k") else 1) for p in re.findall(r"\$\s?\d{2,3}(?:,\d{3})|\$\s?\d{2,3}[kK]", body)]
        pay = [p for p in pay if 30000 <= p <= 400000]
        if pay and max(pay) < 83000:
            continue
        if re.search(r"commission only|commission-only|100% commission", body, re.I):
            continue
        key = (j["co"].lower(), t.lower())
        if key in seen:
            continue
        seen.add(key)
        picks.append(dict(company=j["co"], title=t, location=loc.strip(), pay=f"${min(pay):,} to ${max(pay):,}" if pay else "not posted", url=j["url"]))

    out = {"scanned_sources": len(srcs), "postings": len(jobs), "candidates": picks}
    if "--check" in sys.argv:
        out["gone"] = [dict(id=a.get("company", "") + " / " + a.get("role", ""), url=a.get("url", "")) for a in apps
                       if a.get("status") in ("Evaluated", "queued") and job_id(a.get("url", "")) not in live
                       and re.search(r"greenhouse|lever|ashby|smartrecruiters|samsara|fieldwire", a.get("url", ""))]
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
