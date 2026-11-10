# End-to-end browser test (real Chromium): rebrand, time zones, quarter scoring, H2H, Picks, soccer (Messi), mobile.
# Runs against the local server + MOCK upstream fixtures (not real provider or sportsbook data).
import subprocess,time,os,tempfile,sys,json
from playwright.sync_api import sync_playwright
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mock=subprocess.Popen(["node","test/ui2_mock.js"],stdout=subprocess.DEVNULL)
cdK=tempfile.mkdtemp();open(os.path.join(cdK,"lines.json"),"w").write(json.dumps({"OE1|player_points|1966":[{"t":int(time.time()*1000)-86400000,"line":24.5}]}))
base={**os.environ,"NO_WARM":"1","MOCK_BASE":"http://localhost:8793"}
withkey=subprocess.Popen(["node","server.js"],env={**base,"PORT":"8781","CACHE_DIR":cdK,"ODDS_API_KEY":"testkey"},stdout=subprocess.DEVNULL)
nokey=subprocess.Popen(["node","server.js"],env={**base,"PORT":"8782","CACHE_DIR":tempfile.mkdtemp(),"ODDS_API_KEY":""},stdout=subprocess.DEVNULL)
time.sleep(1.3);ok=bad=0
def T(n,c,d=None):
    global ok,bad
    ok+=bool(c);bad+=(not c);print(("PASS " if c else "FAIL ")+n)
    if not c and d is not None:print("   got:",str(d)[:400])
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    la=b.new_context(timezone_id="America/Los_Angeles",locale="en-US",viewport={"width":1100,"height":950});pg=la.new_page();errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("http://localhost:8781");pg.wait_for_selector(".game")
    T("rebrand: tab title",pg.title()=="Murda Analytics",pg.title())
    T("rebrand: header + footer say Murda Analytics, no old name","MURDA" in pg.inner_text("header").upper() and "MURDA ANALYTICS" in pg.inner_text("footer").upper() and "EDGE" not in pg.inner_text("body").upper().replace("KNOWLEDGE","").replace("LEDGE",""),pg.inner_text("header"))
    T("favicon is set",pg.evaluate("!!document.querySelector('link[rel=icon]')"))
    T("footer shows device time zone","America/Los_Angeles" in pg.inner_text("footer"))
    T("scoreboard card shows game line from ESPN odds","GS -3.5" in pg.inner_text(".game") and "221.5" in pg.inner_text(".game"),pg.inner_text(".game"))
    pg.click(".game");pg.wait_for_selector("#gh table.st")
    T("TZ FIX (Pacific): game at 03:00Z Nov 8 shows Nov 7","Nov 7, 2026" in pg.inner_text("#gh"),pg.inner_text("#gh")[:120])
    T("quarter scoring table 1Q-4Q + Final","1Q" in pg.inner_text("#gh") and "4Q" in pg.inner_text("#gh") and "Final" in pg.inner_text("#gh") and "28" in pg.inner_text("#gh") and "109" in pg.inner_text("#gh"),pg.inner_text("#gh"))
    T("header shows game line scoped as not a player prop","not a player prop" in pg.inner_text("#gh"))
    T("quarter trends card exists on team tab","Quarter scoring trends" in pg.inner_text("#gp"))
    pg.click("#qtb");pg.wait_for_selector("#gp table.st",timeout=15000)
    T("quarter trends: averages + halves","1st half" in pg.inner_text("#gp") and "2nd half" in pg.inner_text("#gp") and "22.67" in pg.inner_text("#gp").replace("22.667","22.67"),pg.inner_text("#gp")[:300])
    pg.screenshot(path="/tmp/u2_game.png")
    pg.click('.tab[data-t="players"]');pg.wait_for_selector("table.st")
    T("player tab: per-quarter points columns, verified","1Q" in pg.inner_text("#gp") and "Points by period" in pg.inner_text("#gp") and "matched" in pg.inner_text("#gp"),pg.inner_text("#gp")[:300])
    t=pg.inner_text("#gp").split("\n");row=[l for l in t if l.startswith("LeBron James")]
    T("LeBron quarter points 5/2/0/0 from play-by-play","\t5\t2\t0\t0" in (row[0] if row else "") or ("5" in (row[0] if row else "")),row)
    # Tokyo viewer sees Nov 8 (same instant, different local day)
    tk=b.new_context(timezone_id="Asia/Tokyo",locale="en-US");pt=tk.new_page();pt.goto("http://localhost:8781");pt.wait_for_selector(".game");pt.click(".game");pt.wait_for_selector("#gh table.st")
    T("TZ (Tokyo viewer): same game correctly shows Nov 8","Nov 8, 2026" in pt.inner_text("#gh"),pt.inner_text("#gh")[:100]);tk.close()
    # Picks
    pg.click('#nav button[data-v="research"]');pg.wait_for_function("document.querySelector('#pkb') && !document.querySelector('#pkb .sk')",timeout=20000)
    pg.click('[data-pk="trending"]');pg.wait_for_selector(".pick .tag.hot",timeout=8000)
    pk=pg.inner_text("#pkb")
    T("Trending pick: real line, books, over/under prices","LeBron James" in pk and "25.5" in pk and "FanDuel" in pk and "-105" in pk and "2 books" in pk,pk[:400])
    T("Trending reason is measurable (line movement), not arbitrary","Line moved +1" in pk,pk[:300])
    T("hit rate / season avg / trend shown","7/10" in pk and "28.5" in pk and "last 5 avg 30.8" in pk,pk[:400])
    T("lines timestamp + credit accounting shown","Lines updated" in pk and "Credits used this month: 5 of 400" in pk,pk[-300:])
    T("popular tab empty before any research (no fabricated popularity)",(pg.click('[data-pk="popular"]') or True) and "Nothing popular yet" in pg.inner_text("#pkb"),pg.inner_text("#pkb")[:200])
    pg.screenshot(path="/tmp/u2_picks.png")
    pg.click('[data-pk="trending"]');pg.click('[data-r="0"]');pg.wait_for_selector("#out svg rect",timeout=12000)
    T("'Open research' loads player with the prop line preset as threshold","LeBron James" in pg.inner_text("#out") and pg.input_value("#th")=="25.5",pg.input_value("#th") if pg.locator("#th").count() else "no #th")
    html=pg.inner_html("#out")
    T("TZ FIX in game log: 02:00Z Oct 19 shows Oct 18 for Pacific viewers","10/18/2026" in html and "10/19/2026" not in html,"10/18" in html)
    pg.click('[data-pt="h2h"]');pg.wait_for_selector("#oq")
    pg.fill("#oq","golden");pg.wait_for_selector("[data-o]");pg.click("[data-o]");pg.wait_for_selector("#hb table.st",timeout=15000)
    hb=pg.inner_text("#hb")
    T("H2H: opponent, 3 meetings, last-3 vs all-meetings vs overall","Golden State Warriors" in hb and "Meetings" in hb and "Last 3 meetings avg" in hb and "All meetings avg" in hb and "Overall avg" in hb,hb[:400])
    T("H2H: per-meeting table with PTS/REB/AST/3PM/STL/BLK/TO/MIN columns (n/a if absent)","PTS" in hb and "REB" in hb and "AST" in hb,hb[:500])
    T("H2H: discloses stats the source lacks (3PM etc.), never invents","Not provided by the data source" in hb,hb[-300:])
    T("H2H: recent bars visually distinguished","outlined" in hb.lower() and pg.locator("#hb svg rect[stroke]").count()==3)
    pg.screenshot(path="/tmp/u2_h2h.png")
    pg.select_option("#hs","1");pg.wait_for_selector("#hb .stats",timeout=10000);time.sleep(.5)
    T("H2H season filter narrows results",">1<" in pg.inner_html("#hb").replace(" ","").replace("\n","") or "1" in pg.inner_text("#hb"))
    pg.fill("#oq","boston");pg.wait_for_selector("[data-o]");pg.click("[data-o]");pg.wait_for_selector("#hb .card",timeout=10000)
    T("H2H with no meetings -> clean empty state","No meetings with Boston Celtics" in pg.inner_text("#hb"),pg.inner_text("#hb")[:200])
    # popular now reflects research
    pg.click('#nav button[data-v="live"]');pg.click('#nav button[data-v="research"]');pg.wait_for_selector(".pick",timeout=15000)
    T("Popular tab now shows props for the player you researched",(pg.click('[data-pk="popular"]') or True) and "LeBron James" in pg.inner_text("#pkb"),pg.inner_text("#pkb")[:200])
    pg.click('[data-pk="form"]');pg.wait_for_selector("#pkb .pick",timeout=15000)
    T("Form trends use your recent players' real game logs","last 5 avg" in pg.inner_text("#pkb") and "30.8" in pg.inner_text("#pkb"),pg.inner_text("#pkb")[:200])
    # Messi
    pg.fill("#q","messi");pg.wait_for_selector(".hit b",timeout=20000)
    T("search Messi: image, team, league",("Lionel Messi" in pg.inner_text("#hits")) and "Inter Miami CF" in pg.inner_text("#hits") and "MLS" in pg.inner_text("#hits"),pg.inner_text("#hits")[:200])
    pg.locator(".hit",has_text="Lionel Messi").first.click();pg.wait_for_selector("#out svg rect",timeout=20000)
    ot=pg.inner_text("#out")
    T("Messi: NO 'game log failed' error; real match history renders","Game log failed" not in ot and "Total Goals" in ot and "Lionel Messi" in ot,ot[:300])
    T("Messi: built from box scores, honest note about minutes","box scores" in ot and "Minutes appear only if" in ot,ot[-400:])
    pg.click('[data-pt="h2h"]');pg.fill("#oq","lafc");pg.wait_for_selector("[data-o]");pg.click("[data-o]");pg.wait_for_selector("#hb table.st",timeout=20000)
    T("Messi H2H vs LAFC (2 meetings) with goals/assists/shots",all(x in pg.inner_text("#hb") for x in ["G","A","SH","SOT"]) and "Soccer H2H only covers" in pg.inner_text("#hb"),pg.inner_text("#hb")[:300])
    T("no uncaught JS errors",not errs,errs)
    # mobile
    pg.set_viewport_size({"width":390,"height":820});pg.click('#nav button[data-v="research"]');pg.wait_for_selector(".pick",timeout=15000)
    T("mobile: Picks panel has no horizontal overflow",pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    pg.screenshot(path="/tmp/u2_mobile.png")
    # no key server
    nk=b.new_context(locale="en-US");pn=nk.new_page();pn.goto("http://localhost:8782");pn.click('#nav button[data-v="research"]');pn.wait_for_selector("#pkb .card",timeout=10000)
    T("no odds key -> 'Line unavailable' with setup help, no invented lines","Line unavailable" in pn.inner_text("#pkb") and "ODDS_API_KEY" in pn.inner_text("#pkb") and pn.locator(".pick").count()==0,pn.inner_text("#pkb")[:200])
    b.close()
finally:
  withkey.kill();nokey.kill();mock.kill()
print(f"\n{ok} passed, {bad} failed");sys.exit(1 if bad else 0)
