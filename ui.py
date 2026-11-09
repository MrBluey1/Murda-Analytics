# End-to-end browser test (real Chromium) against the local server + MOCK upstream fixtures. Not real provider data.
import subprocess,time,os,tempfile,sys
from playwright.sync_api import sync_playwright
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mock=subprocess.Popen(["node","test/ui_mock.js"],stdout=subprocess.DEVNULL)
env={**os.environ,"PORT":"8794","NO_WARM":"1","MOCK_BASE":"http://localhost:8796","CACHE_DIR":tempfile.mkdtemp()}
srv=subprocess.Popen(["node","server.js"],env=env,stdout=subprocess.DEVNULL);time.sleep(1.2)
ok=bad=0
def T(n,c):
    global ok,bad
    ok+=c;bad+=(not c);print(("PASS " if c else "FAIL ")+n)
try:
  with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={"width":1100,"height":900});errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("http://localhost:8794");pg.wait_for_selector(".game")
    T("live game card renders with logo",pg.locator(".game img.logo-s").count()>=2 and "LIVE" in pg.inner_text(".game"))
    pg.click(".game");pg.wait_for_selector(".cmp")
    T("game header: teams, score, status, clock","Warriors" in pg.inner_text("#gh") and "80" in pg.inner_text("#gh") and "LIVE" in pg.inner_text("#gh") and "5:12" in pg.inner_text("#gh"))
    T("two tabs present",pg.locator(".tab").count()==2)
    T("team tab: side-by-side rows","Field Goals" in pg.inner_text("#gp") and "30-60" in pg.inner_text("#gp") and "Points in the Paint" in pg.inner_text("#gp"))
    T("team tab states what the provider did not send","Not provided by ESPN" in pg.inner_text("#gp") and "Fast-Break" in pg.inner_text("#gp"))
    pg.screenshot(path="/tmp/shot_team.png")
    pg.click('.tab[data-t="players"]');pg.wait_for_selector("table.st")
    T("player tab: every listed player incl. bench DNP + reason","LeBron James" in pg.inner_text("#gp") and "Bench Guy" in pg.inner_text("#gp") and "COACH'S DECISION" in pg.inner_text("#gp") and "Stephen Curry" in pg.inner_text("#gp"))
    T("player tab: column labels MIN/PTS/REB and Starter role",all(x in pg.inner_text("#gp") for x in ["MIN","PTS","REB","Starter"]))
    pg.screenshot(path="/tmp/shot_players.png")
    pg.click('.tab[data-t="team"]');T("switch back to team tab","Field Goals" in pg.inner_text("#gp"))
    pg.click("#back");pg.wait_for_selector(".game")
    pg.click('#lgs .chip:has-text("Premier League")');pg.wait_for_selector(".game");pg.click(".game")
    pg.wait_for_selector(".cmp",timeout=8000)
    T("soccer completed game opens (FINAL)","FINAL" in pg.inner_text("#gh"))
    T("soccer team stats + unavailable xG disclosed","Possession" in pg.inner_text("#gp") and "Expected Goals" in pg.inner_text("#gp"))
    pg.click('.tab[data-t="players"]');pg.wait_for_selector("table.st")
    T("soccer players: starter + substitute shown","Erling Haaland" in pg.inner_text("#gp") and "Sub (in)" in pg.inner_text("#gp"))
    # research
    pg.click('#nav button[data-v="research"]');pg.fill("#q","luka doncic");pg.wait_for_selector(".hit b",timeout=15000)
    T("search 'luka doncic' finds Dončić with team + league",("Luka Dončić" in pg.inner_text("#hits")) and "Los Angeles Lakers" in pg.inner_text("#hits") and "NBA" in pg.inner_text("#hits"))
    pg.screenshot(path="/tmp/shot_search.png")
    pg.locator(".hit",has_text="Luka Dončić").first.click();pg.wait_for_selector("#out svg rect",timeout=8000)
    T("profile: bar chart + stats render for selected player","Luka Dončić" in pg.inner_text("#out") and pg.locator("#out svg rect").count()>=10)
    T("NBA derived stat PRA offered","PRA" in pg.inner_text("#out"))
    pg.screenshot(path="/tmp/shot_profile.png")
    pg.fill("#q","");pg.fill("#q","mbappe");pg.wait_for_selector(".hit b",timeout=15000)
    T("soccer search 'mbappe' (no accent)","Kylian Mbappé" in pg.inner_text("#hits") and "Real Madrid" in pg.inner_text("#hits"))
    pg.locator(".hit",has_text="Mbappé").first.click();pg.wait_for_selector(".err",timeout=8000)
    T("soccer profile shows player + honest unavailable message","Kylian Mbappé" in pg.inner_text("#out") and "not available" in pg.inner_text("#out"))
    pg.fill("#q","");pg.fill("#q","lakers");pg.wait_for_selector("[data-t]",timeout=15000)
    pg.locator("[data-t]").first.click();pg.wait_for_selector("#rost .hit",timeout=8000)
    T("team search -> roster list -> player",("LeBron James" in pg.inner_text("#rost")))
    pg.fill("#q","zzzzqq") if pg.locator("#q").count() else None
    T("no uncaught JS errors in page",len(errs)==0)
    if errs:print(errs)
    pg.set_viewport_size({"width":390,"height":800});pg.click('#nav button[data-v="live"]');pg.wait_for_selector(".game");pg.click(".game");pg.wait_for_selector(".cmp")
    T("mobile: no horizontal page overflow",pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    pg.screenshot(path="/tmp/shot_mobile.png");b.close()
finally:
  srv.kill();mock.kill()
print(f"\n{ok} passed, {bad} failed");sys.exit(1 if bad else 0)
