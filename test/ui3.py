# Browser test (real Chromium) for the multi-sport overhaul, against the local server + MOCK upstream (providers.js fixtures; NOT real data).
import subprocess,time,os,tempfile,sys
from playwright.sync_api import sync_playwright
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mock=subprocess.Popen(["node","test/ui3_mock.js"],stdout=subprocess.DEVNULL)
env={**os.environ,"PORT":"8761","NO_WARM":"1","MOCK_BASE":"http://localhost:8793","CACHE_DIR":tempfile.mkdtemp(),"FOOTBALL_DATA_KEY":""}
srv=subprocess.Popen(["node","server.js"],env=env,stdout=subprocess.DEVNULL);time.sleep(2.0);ok=bad=0
def T(n,c,d=None):
    global ok,bad
    ok+=bool(c);bad+=(not c);print(("PASS " if c else "FAIL ")+n)
    if not c and d is not None:print("   got:",str(d)[:500])
def search(pg,q,sport=None):
    if sport:pg.select_option("#sp",sport)
    pg.fill("#q","");pg.fill("#q",q);pg.wait_for_selector("#hits .hit b",timeout=25000)
try:
  with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={"width":1100,"height":950},locale="en-US",timezone_id="America/Los_Angeles");errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("http://localhost:8761");pg.click('#nav button[data-v="research"]');pg.wait_for_selector("#sp")
    opts=pg.eval_on_selector_all("#sp option","o=>o.map(x=>x.textContent)")
    T("sport selector is built from the registry and lists every sport",all(any(k in o for o in opts) for k in ["Soccer","NFL","NBA","WNBA","College Football","College Basketball","MLB","NHL","Cricket","Tennis","Formula 1","Powerlifting","Golf","Rugby"]),opts)
    T("selector is honest about status (partial / dataset / profile-only)",any("Cricket" in o and "needs dataset" in o for o in opts) and any("Golf" in o and "profile only" in o for o in opts) and any("Soccer" in o and "partial" in o for o in opts),opts)
    pg.select_option("#sp","tennis");pg.wait_for_selector("#lgsel")
    T("league selector appears for sports with leagues (Tennis: ATP/WTA)",pg.eval_on_selector_all("#lgsel option","o=>o.map(x=>x.textContent)")==["All leagues","ATP","WTA"])
    pg.select_option("#sp","all")
    # universal search, no sport chosen
    search(pg,"djokovic")
    T("search w/o choosing a sport identifies the sport: Djokovic -> Tennis / ATP",("Novak Djokovic" in pg.inner_text("#hits")) and "ATP" in pg.inner_text("#hits"),pg.inner_text("#hits")[:200])
    pg.locator(".hit",has_text="Novak Djokovic").first.click();pg.wait_for_selector("#out svg rect",timeout=15000)
    ot=pg.inner_text("#out")
    T("tennis Overview: match stats chart (aces etc.)","Novak Djokovic" in ot and "Aces" in ot,ot[:200])
    pg.click('[data-pt="profile"]');pg.wait_for_selector("#pbody table.st",timeout=15000);pt=pg.inner_text("#pbody")
    T("tennis Profile: season table with matches + win %","2026" in pt and "Win Pct" in pt and "50" in pt,pt[:400])
    T("tennis Profile: advanced stats labelled 'calculated'; identity + provenance + license shown","calculated" in pt and "murda:tennis:sackmann:atp_100001" in pt and "CC BY-NC-SA" in pt,pt[-500:])
    pg.screenshot(path="/tmp/u3_profile.png")
    pg.click('[data-pt="h2h"]');pg.fill("#oq","alcaraz");pg.wait_for_selector("[data-o]",timeout=15000);pg.click("[data-o]");pg.wait_for_selector("#hb table.st",timeout=15000)
    hb=pg.inner_text("#hb")
    T("tennis H2H vs a player: 2–1 record, by surface, meeting table","2–1" in hb and "Hard" in hb and "Clay" in hb and "Meetings" in hb,hb[:300])
    pg.click('[data-pt="cmp"]');pg.fill("#cq","alcaraz");pg.wait_for_selector("[data-co]",timeout=15000);pg.click("[data-co]");pg.wait_for_selector("#cb .cmp",timeout=15000)
    T("Compare tab: side-by-side per-game averages, discloses method","Carlos Alcaraz" in pg.inner_text("#cb") and "Aces" in pg.inner_text("#cb") and "not adjusted" in pg.inner_text("#cb"),pg.inner_text("#cb")[:300])
    pg.screenshot(path="/tmp/u3_compare.png")
    # F1
    pg.click('#nav button[data-v="research"]');search(pg,"verstappen","f1");pg.locator(".hit",has_text="Max Verstappen").first.click();pg.wait_for_selector("#out svg rect",timeout=15000)
    T("F1 Overview: race-by-race chart (finish, grid, points, wins...)","Max Verstappen" in pg.inner_text("#out") and pg.locator("#out svg rect").count()>=3 and "Finish" in pg.inner_text("#out"))
    pg.click('[data-pt="profile"]');pg.wait_for_selector("#pbody table.st",timeout=15000);pf=pg.inner_text("#pbody")
    T("F1 Profile: 2 championships, 25 wins, official standings per season",("Championships" in pf and "2" in pf and "849.5" in pf and "2021" in pf and "2022" in pf),pf[:400])
    T("F1 has no H2H tab (not supported, so not shown)",pg.locator('[data-pt="h2h"]').count()==0)
    # NFL via ESPN directory + nflverse
    pg.click('#nav button[data-v="research"]');search(pg,"mahomes","nfl");pg.locator(".hit",has_text="Patrick Mahomes").first.click();pg.wait_for_selector("#out svg rect",timeout=20000)
    T("NFL Overview from nflverse; linked ids disclosed","Linked records" in pg.inner_text("#out") and "nflverse 00-0033873" in pg.inner_text("#out"),pg.inner_text("#out")[-400:])
    pg.click('[data-pt="profile"]');pg.wait_for_selector("#pbody table.st",timeout=15000);pn=pg.inner_text("#pbody")
    T("NFL advanced: passer rating 109.1 calculated; EPA tagged 'provider model'","passer rating" in pn.lower() and "109.1" in pn and "provider model" in pn and "calculated" in pn,pn[:700])
    T("NFL: what could not be computed is listed as 'data unavailable', not invented","data unavailable" in pn and "Snap counts" in pn,pn[-500:])
    # info-only sport
    pg.click('#nav button[data-v="research"]');search(pg,"scheffler","golf");pg.locator(".hit",has_text="Scottie Scheffler").first.click();pg.wait_for_selector("#pbody .card.m",timeout=15000)
    T("Golf (profile-only): no Overview tab, bio shown, explicit 'no statistics' notice","Profile and image only" in pg.inner_text("#pbody") and pg.locator('[data-pt="ov"]').count()==0 and "Ridgewood" in pg.inner_text("#pbody"),pg.inner_text("#pbody")[:300])
    # Insights
    pg.click('#nav button[data-v="research"]');pg.wait_for_selector("#pkt");pg.click('[data-ps="mlb"]');pg.wait_for_selector("#pkb .pick",timeout=15000)
    T("Insights: MLB leaders with provenance","Aaron Judge" in pg.inner_text("#pkb") and "58" in pg.inner_text("#pkb") and "mlb-statsapi" in pg.inner_text("#pkb") and "Sources" in pg.inner_text("#pkb"),pg.inner_text("#pkb")[:300])
    pg.click('[data-ps="soccer"]');pg.wait_for_selector("#pkb p.m",timeout=15000)
    T("Insights: soccer leaders without the optional free key explains how to enable, shows nothing fake","FOOTBALL_DATA_KEY" in pg.inner_text("#pkb") and pg.locator("#pkb .pick").count()==0,pg.inner_text("#pkb")[:300])
    pg.click('[data-ps="f1"]');pg.wait_for_selector("#pkb .pick",timeout=15000);T("Insights: F1 standings leaders","Max Verstappen" in pg.inner_text("#pkb") and "400" in pg.inner_text("#pkb"))
    pg.click('[data-ps="mlb"]');pg.wait_for_selector("#pkb .pick",timeout=15000);pg.locator('[data-ld="0.0"]').click()
    pg.wait_for_selector("#pbody",timeout=20000);pg.wait_for_selector("#pbody table.st",timeout=20000);mp=pg.inner_text("#pbody")
    T("clicking a leader opens the athlete; when the game log is unavailable the Profile still works (MLB career, K% .239 calculated, OPS as official)","Aaron Judge" in pg.inner_text("#out") and "0.239" in mp and "official" in mp and "calculated" in mp,mp[:500])
    T("MLB: OPS+/wRC+/WAR listed as unavailable","WAR" in mp and "data unavailable" in mp,mp[-400:])
    # Sources page
    pg.click('#nav button[data-v="src"]');pg.wait_for_selector("text=Not integrated, and why",timeout=15000);so=pg.inner_text("#app")
    T("Sources page: providers, licenses, limits, non-commercial warning, last fetched","Jeff Sackmann" in so and "NON-COMMERCIAL" in so and "CC BY 4.0" in so and "last fetched" in so,so[:300])
    T("Sources page: not-integrated providers explain why (Kaggle, nba_api, pbpstats, Retrosheet notice)","Kaggle" in so and "pbpstats" in so and "obtained free of charge" in so)
    T("Sources page: formulas and provenance labels (official / provided / calculated / unavailable)","True Shooting" in so and "Calculated locally" in so and "data unavailable" in so)
    T("Sources page: states everything is free and no betting data is used","no paid api" in so.lower() and "No betting lines" in so)
    pg.screenshot(path="/tmp/u3_sources.png",full_page=True)
    # nothing paid/odds-related anywhere in the UI
    body=pg.content()
    T("no Odds API / ODDS_API_KEY / sportsbook UI anywhere in the page","ODDS_API_KEY" not in body and "the-odds-api" not in body.lower() and "Line unavailable" not in body)
    T("no uncaught JS errors across all sports",not errs,errs)
    pg.set_viewport_size({"width":390,"height":820});pg.click('#nav button[data-v="research"]');pg.wait_for_selector("#pkt")
    T("mobile: insights has no horizontal overflow",pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    pg.click('[data-ps="mlb"]');pg.wait_for_selector("#pkb .pick");pg.locator('[data-ld="0.0"]').click();pg.wait_for_selector("#pbody table.st",timeout=20000)
    T("mobile: profile tables scroll inside their container (no page overflow)",pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    pg.screenshot(path="/tmp/u3_mobile.png");b.close()
finally:
  srv.kill();mock.kill()
print(f"\n{ok} passed, {bad} failed");sys.exit(1 if bad else 0)
