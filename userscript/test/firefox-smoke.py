"""Opt-in real Steam/CDN test; downloads the model in a disposable Firefox profile.

Requires Mozilla's marionette_driver and a signed Tampermonkey XPI from Mozilla
Add-ons. Example: python test/firefox-smoke.py --firefox /path/to/firefox
--manager-xpi /path/to/tampermonkey.xpi
"""
import argparse
import gc
import json
import socket
from pathlib import Path
import tempfile
import time

from marionette_driver.addons import Addons
from marionette_driver.marionette import Marionette

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--firefox', required=True)
parser.add_argument('--manager-xpi', required=True)
parser.add_argument('--script', type=Path, default=Path(__file__).resolve().parents[1] / 'dist/steam-tag-audit.user.js')
parser.add_argument('--appid', type=int, default=4865920)
args = parser.parse_args()
panel = 'document.querySelector("#steam-tag-analyzer-extension")?.shadowRoot'


def wait_for(browser, expression, timeout=30):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        result = browser.execute_script('return ' + expression)
        if result:
            return result
        time.sleep(0.25)
    raise AssertionError('Timed out: ' + expression)


with tempfile.TemporaryDirectory(prefix='steam-audit-firefox-') as temp:
    with socket.socket() as port_socket:
        port_socket.bind(('127.0.0.1', 0))
        port = port_socket.getsockname()[1]
    browser = Marionette(bin=args.firefox, port=port, headless=True, workspace=temp,
                         gecko_log=str(Path(temp) / 'gecko.log'), startup_timeout=30)
    try:
        browser.start_session()
        print('Firefox', browser.session_capabilities['browserVersion'], flush=True)
        addon = Addons(browser).install(str(Path(args.manager_xpi).resolve()))
        assert addon == 'firefox@tampermonkey.net', 'Use the signed Tampermonkey XPI'
        with browser.using_context('chrome'):
            options = browser.execute_async_script('''
              const done = arguments[arguments.length - 1];
              ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs')
                .AddonManager.getAddonByID(arguments[0]).then(a => done(a.optionsURL));
            ''', [addon])
        browser.navigate(options)
        result = browser.execute_async_script('''
          const [code, done] = arguments;
          window.wrappedJSObject.browser.runtime.sendMessage({
            method: 'saveScript', uuid: 'new-user-script', code, new_script: true, reload: true,
          }).then(r => done(JSON.stringify(r)), e => done(JSON.stringify({error: String(e)})));
        ''', [args.script.read_text()])
        assert json.loads(result).get('installed'), result

        for run in range(3):
            if run == 2:
                browser.restart(in_app=True)
            print(['Cold audit', 'Page reload', 'Browser restart'][run], flush=True)
            with browser.using_context('chrome'):
                browser.execute_script('''
                  if (window.auditObserver) Services.obs.removeObserver(window.auditObserver, 'http-on-modify-request');
                  window.auditRequests = [];
                  window.auditObserver = { observe(channel) {
                    const url = channel.QueryInterface(Ci.nsIHttpChannel).URI.spec;
                    if (url.startsWith('https://projects.cdn.aapanasik.com/steam-tags/') ||
                        url.startsWith('https://steam-tags-api.aapanasik.com/app/') ||
                        url.includes('/onnxruntime-web@1.14.0/')) window.auditRequests.push(url);
                  }};
                  Services.obs.addObserver(window.auditObserver, 'http-on-modify-request');
                ''')
            browser.navigate(f'https://store.steampowered.com/app/{args.appid}/')
            wait_for(browser, '!!(' + panel + ')')
            browser.execute_script(panel + '.querySelector(".launch").click()')
            wait_for(browser, panel + '.querySelector(".run-local")?.disabled === false')
            browser.execute_script(panel + '.querySelector(".run-local").click()')
            last, until = '', time.monotonic() + 600
            while time.monotonic() < until:
                status = browser.execute_script('return ' + panel + '.querySelector("[role=status]").textContent')
                if status != last:
                    print(status, flush=True)
                    last = status
                if 'failed' in status or 'complete' in status:
                    break
                time.sleep(0.5)
            assert last == 'Current Steam audit complete', last
            assert browser.execute_script('return ' + panel + '.querySelectorAll(".tags li").length') > 0
            with browser.using_context('chrome'):
                requests = browser.execute_script('return window.auditRequests')
            if run:
                assert all(url.endswith('manifest.json') or f'/app/{args.appid}' in url for url in requests), requests
            else:
                assert any('game-vectors-' in url for url in requests), requests
            print(f'PASS: {len(requests)} resource requests', flush=True)
    finally:
        browser.cleanup()
        del browser
        gc.collect()
