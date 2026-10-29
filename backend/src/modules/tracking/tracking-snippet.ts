/**
 * Tracking Snippet Generator v3.3
 * Injectable JS for capturing user interactions on external websites.
 *
 * Architecture (rrweb + heatmap events):
 * - DOM recording: rrweb full snapshot + incremental mutations + CSS inlining (5 min cap)
 * - Heatmap data: clicks, scroll, mousemove as raw pixels (backend normalizes)
 * - Session: one per page / per SPA pathname. Persistent visitor ID.
 * - Consent: localStorage primary, sessionStorage fallback (incognito-safe)
 * - rrweb events: XHR every 5s (not sendBeacon — 64KB limit)
 * - Visibility-aware: pauses capture + rrweb when tab is hidden, resumes on focus
 * - Session end: visibilitychange (primary) + beforeunload (backup)
 */

interface SnippetConfig {
    researchId: string;
    apiBaseUrl: string;
    captureClicks: boolean;
    captureScroll: boolean;
    captureMousemove: boolean;
    consentRequired: boolean;
    flushIntervalMs: number;
    maxEventsPerFlush: number;
    allowedDomains: string[];
    consentText: string;
    consentAcceptLabel: string;
    consentDeclineLabel: string;
    consentPosition: 'bottom' | 'top';
    samplingRate: number;
    targetPages: string[];
    excludePages: string[];
    captureEmotions: boolean;
    emotionModelBaseUrl: string;
    captureGaze: boolean;
    eyeEmbedUrl: string;
    zones: Array<{ id: string; pageUrl: string; selector: string }>;
}

const toPagePath = (pageUrl: string): string => {
    try {
        return new URL(pageUrl).pathname;
    } catch {
        return pageUrl;
    }
};

export const generateTrackingSnippet = (config: SnippetConfig): string => {
    return `(function(){
"use strict";
var C=${JSON.stringify({
        rid: config.researchId,
        api: config.apiBaseUrl,
        clicks: config.captureClicks,
        scroll: config.captureScroll,
        mouse: config.captureMousemove,
        consent: config.consentRequired,
        flush: config.flushIntervalMs,
        max: config.maxEventsPerFlush,
        domains: config.allowedDomains,
        cText: config.consentText,
        cAccept: config.consentAcceptLabel,
        cDecline: config.consentDeclineLabel,
        cPos: config.consentPosition,
        sampling: config.samplingRate,
        targetPg: config.targetPages,
        excludePg: config.excludePages,
        emotions: config.captureEmotions,
        emoModelUrl: config.emotionModelBaseUrl,
        gaze: config.captureGaze,
        eyeUrl: config.eyeEmbedUrl,
        zones: config.zones.map((zone) => ({ id: zone.id, path: toPagePath(zone.pageUrl), selector: zone.selector })),
    })};

// ─── State ───────────────────────────────────────────────────────────
var sid=null,vid=null,buf=[],flushing=false,consented=!C.consent;
var timer=null,pageStart=0;
var capturing=false,rrwebStopFn=null,rrwebBuf=[];
var RRWEB_FLUSH_MS=5000;
var RRWEB_MAX_MS=300000; // Stop rrweb recording after 5 min per session
var rrwebStartTime=0;
var paused=false; // true when tab is hidden — all capture stops
var activeMs=0,activeStart=0; // track real active time

// ─── Storage helpers (incognito-safe) ────────────────────────────────
// localStorage primary, sessionStorage fallback, memory last resort
var memStore={};
function store(k,v){
    try{localStorage.setItem(k,v);}catch(e){
        try{sessionStorage.setItem(k,v);}catch(e2){memStore[k]=v;}
    }
}
function load(k){
    try{var v=localStorage.getItem(k);if(v!==null)return v;}catch(e){}
    try{var v2=sessionStorage.getItem(k);if(v2!==null)return v2;}catch(e2){}
    return memStore[k]||null;
}

// ─── Utilities ───────────────────────────────────────────────────────

function checkDomain(){
    if(!C.domains||!C.domains.length)return true;
    var h=location.hostname;
    for(var i=0;i<C.domains.length;i++){
        var d=C.domains[i].replace(/^https?:\\/\\//,"").split("/")[0].split(":")[0];
        if(h===d||h.endsWith("."+d))return true;
    }
    return false;
}

function checkPage(){
    var url=location.href;
    if(C.excludePg&&C.excludePg.length>0){
        for(var i=0;i<C.excludePg.length;i++){if(url.indexOf(C.excludePg[i])>=0)return false;}
    }
    if(C.targetPg&&C.targetPg.length>0){
        for(var j=0;j<C.targetPg.length;j++){if(url.indexOf(C.targetPg[j])>=0)return true;}
        return false;
    }
    return true;
}

function getVid(){
    var v=load("_ecx_vid");
    if(v)return v;
    v="v_"+Math.random().toString(36).substr(2,12)+Date.now().toString(36);
    store("_ecx_vid",v);
    return v;
}

function getSelector(el){
    if(!el||!el.tagName)return"";
    var parts=[],cur=el;
    for(var i=0;i<5&&cur&&cur.tagName;i++){
        var tag=cur.tagName.toLowerCase();
        if(cur.id){parts.unshift(tag+"#"+cur.id);break;}
        var cls=cur.className&&typeof cur.className==="string"
            ?"."+cur.className.trim().split(/\\s+/).slice(0,2).join("."):"";
        parts.unshift(tag+cls);
        cur=cur.parentElement;
    }
    return parts.join(" > ").substr(0,500);
}

function getText(el){
    if(!el)return"";
    return(el.textContent||el.innerText||"").trim().substr(0,255);
}

// ─── Heatmap Event Queue ─────────────────────────────────────────────

function push(evt){
    if(!consented||paused)return;
    evt.timestampMs=evt.timestampMs||Date.now();
    buf.push(evt);
    if(sid&&buf.length>=C.max)flush();
}

function flush(useBeacon){
    if(!buf.length||!sid||flushing)return;
    flushing=true;
    var totalActive=activeMs+(activeStart>0?Date.now()-activeStart:0);
    var url=C.api+"/public/tracking/"+C.rid+"/events";
    while(buf.length){
        var body=JSON.stringify({sessionId:sid,events:buf.splice(0,C.max),activeDurationMs:totalActive});
        try{
            var xhr=new XMLHttpRequest();
            xhr.open("POST",url,!useBeacon); // sync on unload, async otherwise
            xhr.setRequestHeader("Content-Type","application/json");
            xhr.send(body);
        }catch(e){}
    }
    flushing=false;
}

// ─── rrweb Event Queue ───────────────────────────────────────────────

function flushRrweb(useBeacon){
    if(!rrwebBuf.length||!sid)return;
    var batch=rrwebBuf.splice(0,rrwebBuf.length);
    var body=JSON.stringify({sessionId:sid,events:batch});
    var url=C.api+"/public/tracking/"+C.rid+"/rrweb-events";
    // rrweb snapshots can be 500KB+ — sendBeacon silently drops payloads over ~64KB.
    // On page unload / visibility hidden, use synchronous XHR which has no size limit
    // and is still supported in unload handlers by all major browsers.
    try{
        if(useBeacon){
            var xhr=new XMLHttpRequest();
            xhr.open("POST",url,false); // synchronous — guaranteed delivery before tab dies
            xhr.setRequestHeader("Content-Type","application/json");
            xhr.send(body);
        }else{
            var xhr2=new XMLHttpRequest();
            xhr2.open("POST",url,true);
            xhr2.setRequestHeader("Content-Type","application/json");
            xhr2.send(body);
        }
    }catch(e){}
}

// ─── Session Management ──────────────────────────────────────────────

function createSession(){
    if(!consented)return;
    if(pageStart&&Date.now()-pageStart<2000){
        push({eventType:"pageview",metadata:{friction:"speed-browsing"}});
    }
    if(sid){flush();flushRrweb();flushEmotions();flushGaze();}else{buf=[];}
    sid=null;
    pageStart=Date.now();
    activeMs=0;
    activeStart=Date.now();
    paused=false;

    // Stop previous rrweb recording
    if(rrwebStopFn){try{rrwebStopFn();}catch(e){}rrwebStopFn=null;}
    rrwebActiveMs=0;
    emoActiveMs=0;emoStartTime=Date.now();

    var body=JSON.stringify({
        visitorId:vid,
        pageUrl:location.href,
        pageTitle:document.title,
        viewportWidth:window.innerWidth,
        viewportHeight:window.innerHeight,
        screenWidth:screen.width,
        screenHeight:screen.height,
        userAgent:navigator.userAgent,
        referrer:document.referrer
    });

    function onSessionReady(sessionId){
        sid=sessionId;
        // Immediate event so verification detects this session
        push({eventType:"scroll",scrollY:Math.round(window.scrollY),
            scrollDepthPct:Math.min(Math.round((window.scrollY+window.innerHeight)/
                Math.max(document.body.scrollHeight||1,document.documentElement.scrollHeight||1)*100),100)});
        if(buf.length>0)flush();
        startRrwebRecording();
        if(rrwebBuf.length>0)flushRrweb();
        startCameraCapture();
        // Capture DOM snapshot with inlined CSS (self-contained backdrop)
        setTimeout(function(){
            if(!consented)return;
            try{
                var sheets=document.querySelectorAll('link[rel="stylesheet"],link[type="text/css"]');
                var pending=sheets.length;
                var cssTexts=[];
                if(pending===0){sendSnapshot("");return}
                var done=0;
                sheets.forEach(function(link,i){
                    var href=link.getAttribute("href");
                    if(!href){done++;if(done===pending)finish();return}
                    var x=new XMLHttpRequest();
                    x.open("GET",href,true);
                    x.onload=function(){cssTexts[i]=x.status===200?x.responseText:"";done++;if(done===pending)finish()};
                    x.onerror=function(){cssTexts[i]="";done++;if(done===pending)finish()};
                    x.send();
                });
                function finish(){
                    var inlined="";
                    for(var j=0;j<cssTexts.length;j++){if(cssTexts[j])inlined+="<style>"+cssTexts[j]+"<\/style>\\n"}
                    sendSnapshot(inlined);
                }
                function sendSnapshot(inlinedCSS){
                    try{
                        var html=document.documentElement.outerHTML;
                        html=html.replace(/<link[^>]*rel\\s*=\\s*["']stylesheet["'][^>]*>/gi,"");
                        html=html.replace(/<link[^>]*type\\s*=\\s*["']text\\/css["'][^>]*>/gi,"");
                        if(html.indexOf("</head>")!==-1){
                            html=html.replace("</head>",inlinedCSS+"</head>");
                        }else{
                            html=inlinedCSS+html;
                        }
                        if(html.length>4000000)return;
                        var sx=new XMLHttpRequest();
                        sx.open("POST",C.api+"/public/tracking/"+C.rid+"/snapshot",true);
                        sx.setRequestHeader("Content-Type","application/json");
                        sx.send(JSON.stringify({pageUrl:location.href,html:html}));
                    }catch(e){}
                }
            }catch(e){}
        },3000);
    }

    var xhr=new XMLHttpRequest();
    xhr.open("POST",C.api+"/public/tracking/"+C.rid+"/session",true);
    xhr.setRequestHeader("Content-Type","application/json");
    xhr.onload=function(){
        if(xhr.status>=400)return;
        try{
            var r=JSON.parse(xhr.responseText);
            if(r.sessionId)onSessionReady(r.sessionId);
        }catch(e){}
    };
    xhr.onerror=function(){
        setTimeout(function(){
            var xhr2=new XMLHttpRequest();
            xhr2.open("POST",C.api+"/public/tracking/"+C.rid+"/session",true);
            xhr2.setRequestHeader("Content-Type","application/json");
            xhr2.onload=function(){
                if(xhr2.status>=400)return;
                try{
                    var r=JSON.parse(xhr2.responseText);
                    if(r.sessionId)onSessionReady(r.sessionId);
                }catch(e2){}
            };
            xhr2.send(body);
        },2000);
    };
    xhr.send(body);

    push({eventType:"pageview",scrollY:0,scrollDepthPct:0});
}

// ─── rrweb Recording ─────────────────────────────────────────────────

var rrwebActiveMs=0; // accumulated active rrweb recording time
function startRrwebRecording(){
    if(!consented||!window.rrweb||!window.rrweb.record)return;
    rrwebStartTime=Date.now();
    rrwebStopFn=window.rrweb.record({
        emit:function(event){
            // Cap recording at 5 min of active time to prevent unbounded growth
            var elapsed=rrwebActiveMs+(Date.now()-rrwebStartTime);
            if(elapsed>RRWEB_MAX_MS){
                if(rrwebStopFn){try{rrwebStopFn();}catch(e){}rrwebStopFn=null;}
                return;
            }
            rrwebBuf.push(event);
        },
        inlineStylesheet:true,
        recordCanvas:false,
        maskAllInputs:true,
        sampling:{mousemove:50,mouseInteraction:true,scroll:150,input:"last"},
        collectFonts:true,
        inlineImages:true,
        recordCrossOriginIframes:false
    });
}

// ─── Capture Listeners (heatmap data) ────────────────────────────────

function startCapture(){
    if(capturing)return;
    capturing=true;

    var clickLog=[];

    if(C.clicks){
        document.addEventListener("click",function(e){
            var now=Date.now();
            var px=e.pageX;
            var py=e.pageY;

            var meta={};

            clickLog.push({x:px,y:py,t:now});
            clickLog=clickLog.filter(function(c){return now-c.t<1000;});
            var nearby=clickLog.filter(function(c){
                return Math.abs(c.x-px)<30&&Math.abs(c.y-py)<30;
            });
            if(nearby.length>=3)meta.friction="rage-click";

            var tag=(e.target.tagName||"").toLowerCase();
            var isInteractive=tag==="a"||tag==="button"||tag==="input"||
                tag==="select"||tag==="textarea"||
                e.target.closest("a,button,[role=button],[onclick]");
            if(!isInteractive&&!meta.friction)meta.friction="dead-click";

            var elOx=null,elOy=null,elW=null,elH=null;
            try{
                var rect=e.target.getBoundingClientRect();
                if(rect.width>0&&rect.height>0){
                    elOx=Math.round((e.clientX-rect.left)/rect.width*10000)/100;
                    elOy=Math.round((e.clientY-rect.top)/rect.height*10000)/100;
                    elW=Math.round(rect.width);
                    elH=Math.round(rect.height);
                }
            }catch(ex){}

            push({
                eventType:"click",
                x:Math.round(px),
                y:Math.round(py),
                targetSelector:getSelector(e.target),
                targetText:getText(e.target),
                elementOffsetX:elOx,
                elementOffsetY:elOy,
                elementWidth:elW,
                elementHeight:elH,
                metadata:Object.keys(meta).length?meta:undefined
            });
        },true);
    }

    if(C.scroll){
        var scrollTimer=null;
        window.addEventListener("scroll",function(){
            clearTimeout(scrollTimer);
            scrollTimer=setTimeout(function(){
                var docH=Math.max(
                    document.body.scrollHeight||0,
                    document.documentElement.scrollHeight||0
                );
                var pct=docH>0?Math.round((window.scrollY+window.innerHeight)/docH*100):0;
                push({
                    eventType:"scroll",
                    scrollY:Math.round(window.scrollY),
                    scrollDepthPct:Math.min(pct,100)
                });
            },150);
        },true);
    }

    if(C.mouse){
        var lastMove=0;
        document.addEventListener("mousemove",function(e){
            var now=Date.now();
            if(now-lastMove<500)return; // 2/s max
            lastMove=now;
            push({
                eventType:"mousemove",
                x:Math.round(e.pageX),
                y:Math.round(e.pageY)
            });
        },true);
    }

    // Visibility-aware capture: pause when tab hidden, resume when visible
    var hiddenAt=0;
    document.addEventListener("visibilitychange",function(){
        if(document.visibilityState==="hidden"){
            // Tab lost focus — pause all capture
            paused=true;
            hiddenAt=Date.now();
            if(activeStart>0)activeMs+=Date.now()-activeStart;
            activeStart=0;
            // Accumulate rrweb active time and stop recording
            if(rrwebStopFn){
                rrwebActiveMs+=Date.now()-rrwebStartTime;
                try{rrwebStopFn();}catch(e){}rrwebStopFn=null;
            }
            // Pause emotion capture
            if(emoRunning){emoActiveMs+=Date.now()-emoStartTime;stopEmotionCapture();}
            // Flush pending data before going to background
            flush(true);
            flushRrweb(true);
            flushEmotions(true);flushGaze(true);
            cameraReleaseTimer=setTimeout(releaseCamera,30000);
        }else{
            // Tab regained focus
            clearTimeout(cameraReleaseTimer);
            var away=Date.now()-hiddenAt;
            if(away>30000){
                // Away >30s — start fresh session (old one already flushed)
                stopEmotionCapture();releaseCamera();
                createSession();
            }else{
                // Brief switch — resume existing session
                paused=false;
                activeStart=Date.now();
                startRrwebRecording();
                if(isCaptureStarted&&emoStream&&!emoRunning)startSampling();
            }
        }
    });

    window.addEventListener("beforeunload",function(){
        if(activeStart>0)activeMs+=Date.now()-activeStart;
        if(pageStart&&activeMs<2000){
            // Force-push so the event gets into buf before flush
            paused=false;
            push({eventType:"pageview",metadata:{friction:"speed-browsing"}});
        }
        flush(true);
        flushRrweb(true);
        if(isEyeFlowOpen)reportCaptureError("calibration-abandoned",true);
        stopEmotionCapture();
        flushEmotions(true);
        flushGaze(true);
    });

    // SPA navigation — new session only when pathname changes, 1s debounce
    var origPush=history.pushState,origReplace=history.replaceState;
    var navTimer=null;
    function getPath(){return location.origin+location.pathname;}
    var lastPath=getPath();
    function onNav(){
        var p=getPath();
        if(p===lastPath)return;
        lastPath=p;
        clearTimeout(navTimer);
        navTimer=setTimeout(createSession,1000);
    }
    history.pushState=function(){origPush.apply(history,arguments);onNav();};
    history.replaceState=function(){origReplace.apply(history,arguments);onNav();};
    window.addEventListener("popstate",onNav);

    timer=setInterval(function(){flush();flushEmotions();flushGaze();},C.flush);
    setInterval(flushRrweb,RRWEB_FLUSH_MS);
}

// ─── Consent Banner ──────────────────────────────────────────────────

function showConsent(){
    var pos=C.cPos==="top"?"top:0;":"bottom:0;";
    var shadow=C.cPos==="top"?"box-shadow:0 2px 10px rgba(0,0,0,0.15);":"box-shadow:0 -2px 10px rgba(0,0,0,0.15);";
    var d=document.createElement("div");d.id="_ecx_consent";
    d.style.cssText="position:fixed;"+pos+"left:0;right:0;background:#1e293b;color:#fff;padding:12px 20px;font-family:-apple-system,sans-serif;font-size:14px;z-index:2147483647;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;"+shadow;
    var copy=visitorCopy();
    var cameraButton=hasCameraFeatures()?'<button id="_ecx_accept_camera" style="background:#16a34a;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">'+copy.acceptWithCamera+'</button>':'';
    d.innerHTML='<span style="flex:1 1 280px;line-height:1.45;">'+(C.cText||describeConsent())+'</span><div style="display:flex;flex-wrap:wrap;gap:8px;"><button id="_ecx_accept" style="background:#2563eb;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">'+(C.cAccept||copy.accept)+'</button>'+cameraButton+'<button id="_ecx_reject" style="background:transparent;color:#94a3b8;border:1px solid #475569;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">'+(C.cDecline||copy.decline)+'</button></div>';
    document.body.appendChild(d);
    var accept=function(isCameraOn){
        consented=true;d.remove();
        store("_ecx_consent_"+C.rid,"1");
        store(CAMERA_INVITE_KEY,"1");
        startSession();
        if(isCameraOn)openCameraCapture();
    };
    document.getElementById("_ecx_accept").onclick=function(){accept(false);};
    if(cameraButton)document.getElementById("_ecx_accept_camera").onclick=function(){accept(true);};
    document.getElementById("_ecx_reject").onclick=function(){
        d.remove();
        store("_ecx_consent_"+C.rid,"0");
        showNotice(copy.declined);
        renderResumePill();
    };
}

var NOTICE_MS=5000;
function showNotice(text){
    removeElement("_ecx_notice");
    var notice=document.createElement("div");notice.id="_ecx_notice";notice.setAttribute("role","status");
    notice.textContent=text;
    notice.style.cssText="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:calc(100% - 32px);background:#1e293b;color:#fff;padding:10px 16px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:13px;line-height:1.4;z-index:2147483647;box-shadow:0 4px 14px rgba(0,0,0,0.25);";
    document.body.appendChild(notice);
    setTimeout(function(){notice.remove();},NOTICE_MS);
}

// ─── Start Session ───────────────────────────────────────────────────

function startSession(){
    vid=getVid();
    startCapture();
    createSession();
    renderRecordingPill();
    showCameraInvite();
}

var PILL_STYLE="position:fixed;left:16px;bottom:16px;display:flex;align-items:center;gap:10px;background:#1e293b;color:#fff;border-radius:999px;padding:8px 8px 8px 14px;font-family:-apple-system,sans-serif;font-size:13px;font-weight:600;line-height:1.2;z-index:2147483646;box-shadow:0 4px 14px rgba(0,0,0,0.25);";
var PILL_BUTTON_STYLE="background:#fff;color:#1e293b;border:none;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;";
function renderPill(id,text,action,onAction){
    removeElement(id);
    var pill=document.createElement("div");pill.id=id;pill.setAttribute("role","status");
    pill.style.cssText=PILL_STYLE;
    var label=document.createElement("span");label.textContent=text;
    var button=document.createElement("button");button.type="button";button.textContent=action;
    button.style.cssText=PILL_BUTTON_STYLE;
    button.onclick=onAction;
    pill.appendChild(label);pill.appendChild(button);
    document.body.appendChild(pill);
}

function renderResumePill(){
    var copy=visitorCopy();
    renderPill("_ecx_off","\u25cb "+copy.off,copy.resume,function(){removeElement("_ecx_off");showConsent();});
}

function renderRecordingPill(){
    var copy=visitorCopy();
    renderPill("_ecx_rec","\u25cf "+copy.recording,copy.stop,stopTrackingByChoice);
}

function stopTrackingByChoice(){
    flush();flushRrweb();flushEmotions();flushGaze();
    consented=false;
    store("_ecx_consent_"+C.rid,"0");
    if(rrwebStopFn){try{rrwebStopFn();}catch(e){}rrwebStopFn=null;}
    stopCameraByChoice();
    removeElement("_ecx_rec");removeElement("_ecx_cam_tab");removeElement("_ecx_cam_invite");
    showNotice(visitorCopy().stopped);
    renderResumePill();
}

// ─── Emotion + Gaze Recognition (MediaPipe FaceLandmarker) ──────────

var emoBuf=[],gazeBuf=[],emoRunning=false,emoVideo=null,emoStream=null;
var emoActiveMs=0,emoStartTime=0;
var EMO_MAX_MS=300000; // 5 min cap
var emoInterval=null;
var EXPRESSION_MAP={happy:"joy",sad:"sadness",angry:"anger",surprised:"surprise",disgusted:"disgust",fearful:"fear",neutral:"neutral"};

var HEAD_DIST_DEG=30;
function attnState(vis,yaw,pitch){
    if(!vis)return"away";
    if(Math.abs(yaw)>HEAD_DIST_DEG||Math.abs(pitch)>HEAD_DIST_DEG)return"distracted";
    return"engaged";
}
function viewportQuadrant(x,y){
    var col=x<window.innerWidth/3?"left":x>window.innerWidth*2/3?"right":"center";
    var row=y<window.innerHeight/3?"top":y>window.innerHeight*2/3?"bottom":"center";
    return row==="center"&&col==="center"?"center":row+"-"+col;
}
function attnScore(st){return st==="away"?0:st==="distracted"?0.3:1;}

// I-DT fixation detection (simplified dispersion-threshold)
var fixState={cx:0,cy:0,startT:0,sumX:0,sumY:0,count:0,active:false};
var FIX_RADIUS_PX=100,FIX_MIN_MS=200;
var fixBuf=[];
function zoneRectsOnPage(){
    var rects={},sx=window.scrollX,sy=window.scrollY;
    for(var i=0;i<C.zones.length;i++){
        var zone=C.zones[i];
        if(zone.path!==location.pathname)continue;
        var el=null;
        try{el=document.querySelector(zone.selector);}catch(e){}
        if(!el)continue;
        var r=el.getBoundingClientRect();
        if(r.width>0&&r.height>0)rects[zone.id]=[Math.round(r.left+sx),Math.round(r.top+sy),Math.round(r.width),Math.round(r.height)];
    }
    return rects;
}
function feedFixation(x,y,ts){
    if(!fixState.active){
        fixState={cx:x,cy:y,startT:ts,sumX:x,sumY:y,count:1,active:true};
        return;
    }
    var dx=x-fixState.cx,dy=y-fixState.cy;
    if(Math.sqrt(dx*dx+dy*dy)<=FIX_RADIUS_PX){
        fixState.sumX+=x;fixState.sumY+=y;fixState.count++;
        return;
    }
    var dur=ts-fixState.startT;
    if(dur>=FIX_MIN_MS){
        fixBuf.push({type:"fixation",x:Math.round(fixState.sumX/fixState.count),y:Math.round(fixState.sumY/fixState.count),duration:Math.round(dur),timestamp:fixState.startT,zones:zoneRectsOnPage()});
    }
    fixState={cx:x,cy:y,startT:ts,sumX:x,sumY:y,count:1,active:true};
}

var CAMERA_CHOICE_KEY="_ecx_cam_"+C.rid,CAMERA_INVITE_KEY="_ecx_cam_invite_"+C.rid,EYE_CALIBRATION_KEY="_ecx_eye_cal_"+C.rid,EYE_CALIBRATION_REUSE_MS=600000;
var VISITOR_COPY={
    es:{title:"Este sitio participa en un estudio de experiencia de usuario.",acceptLead:"Si aceptas, guardamos c\\u00f3mo usas la p\\u00e1gina: ",activeLead:"Este sitio guarda c\\u00f3mo usas la p\\u00e1gina: ",clicks:"clics",scroll:"scroll",mouse:"movimiento del rat\\u00f3n",screen:"una grabaci\\u00f3n de la pantalla de este sitio",and:" y ",notRecorded:"No guardamos lo que escribes en formularios, tu nombre ni tu IP.",cameraOptional:"La c\\u00e1mara es aparte y opcional: solo se activa si la eliges, y sus im\\u00e1genes no salen de tu dispositivo.",declineInfo:"Si rechazas no se guarda nada y el sitio funciona igual. Si aceptas, puedes detenerlo cuando quieras.",accept:"Aceptar",decline:"Rechazar",declined:"No registraremos tu navegaci\\u00f3n. Puedes seguir usando el sitio con normalidad.",recording:"Registrando tu navegaci\\u00f3n",stop:"Detener",stopped:"Dejamos de registrar tu navegaci\\u00f3n. Puedes seguir usando el sitio con normalidad.",off:"Registro desactivado",resume:"Activar",invite:"Opcional: ay\\u00fadanos midiendo tu atenci\\u00f3n y emociones con la c\\u00e1mara; las im\\u00e1genes no salen de tu dispositivo.",activate:"Activar c\\u00e1mara",dismiss:"Entendido",acceptWithCamera:"Aceptar y activar c\\u00e1mara",tabOff:"Ay\\u00fadanos con tu c\\u00e1mara",tabOn:"C\\u00e1mara activa \\u00b7 desactivar"},
    en:{title:"This site is part of a user experience study.",acceptLead:"If you accept, we save how you use the page: ",activeLead:"This site saves how you use the page: ",clicks:"clicks",scroll:"scroll",mouse:"mouse movement",screen:"a screen recording of this site",and:" and ",notRecorded:"We do not save what you type in forms, your name or your IP.",cameraOptional:"The camera is separate and optional: it only turns on if you choose it, and its images never leave your device.",declineInfo:"If you decline, nothing is saved and the site works the same. If you accept, you can stop it at any time.",accept:"Accept",decline:"Decline",declined:"We will not record your browsing. You can keep using the site as usual.",recording:"Recording your browsing",stop:"Stop",stopped:"We stopped recording your browsing. You can keep using the site as usual.",off:"Recording off",resume:"Turn on",invite:"Optional: help us by measuring your attention and emotions with the camera; images never leave your device.",activate:"Turn on camera",dismiss:"Got it",acceptWithCamera:"Accept and turn on camera",tabOff:"Help us with your camera",tabOn:"Camera on \\u00b7 turn off"}
};
function visitorCopy(){return VISITOR_COPY[pageLanguage()];}
function describeRecording(lead){
    var copy=visitorCopy(),items=[];
    if(C.clicks)items.push(copy.clicks);
    if(C.scroll)items.push(copy.scroll);
    if(C.mouse)items.push(copy.mouse);
    items.push(copy.screen);
    var listed=items.length>1?items.slice(0,-1).join(", ")+copy.and+items[items.length-1]:items[0];
    return lead+listed+". "+copy.notRecorded;
}
function describeConsent(){
    var copy=visitorCopy();
    return "<strong>"+copy.title+"</strong><br>"+describeRecording(copy.acceptLead)+" "+(hasCameraFeatures()?copy.cameraOptional+" ":"")+copy.declineInfo;
}
function hasCameraFeatures(){return !!(C.emotions||C.gaze);}
function isCameraChosen(){return load(CAMERA_CHOICE_KEY)==="1";}
function activateCameraCapture(){
    store(CAMERA_INVITE_KEY,"1");
    removeElement("_ecx_cam_invite");renderCameraTab();
    openCameraCapture();
}
function markCameraOn(){
    store(CAMERA_CHOICE_KEY,"1");
    renderCameraTab();
}
function hasFreshCalibration(){
    try{
        var stored=JSON.parse(load(EYE_CALIBRATION_KEY)||"null");
        return !!stored&&Date.now()-stored.savedAt<EYE_CALIBRATION_REUSE_MS;
    }catch(e){return false;}
}
function stopCameraByChoice(){
    store(CAMERA_CHOICE_KEY,"0");
    stopEmotionCapture();releaseCamera();renderCameraTab();
}
function skipCameraCapture(){
    reportCaptureError("camera-skipped");
    stopCameraByChoice();
}
function removeElement(id){var el=document.getElementById(id);if(el)el.remove();}
var CAMERA_ICON_SVG='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/></svg>';
function renderCameraTab(){
    removeElement("_ecx_cam_tab");
    if(!hasCameraFeatures())return;
    var isOn=isCameraChosen();
    var tab=document.createElement("button");tab.id="_ecx_cam_tab";tab.type="button";
    var icon=document.createElement("span");icon.innerHTML=CAMERA_ICON_SVG;
    icon.style.cssText="display:flex;width:16px;height:16px;";
    var label=document.createElement("span");label.textContent=isOn?visitorCopy().tabOn:visitorCopy().tabOff;
    tab.appendChild(icon);tab.appendChild(label);
    tab.style.cssText="position:fixed;right:16px;bottom:"+(window.innerWidth<640?"68px":"16px")+";display:flex;align-items:center;gap:8px;background:"+(isOn?"#166534":"#1e40af")+";color:#fff;border:none;border-radius:999px;padding:10px 16px;font-family:-apple-system,sans-serif;font-size:13px;font-weight:600;line-height:1.2;cursor:pointer;z-index:2147483646;box-shadow:0 4px 14px rgba(0,0,0,0.25);";
    tab.onclick=function(){if(isCameraChosen())stopCameraByChoice();else activateCameraCapture();};
    document.body.appendChild(tab);
}
function showCameraInvite(){
    if(!hasCameraFeatures())return;
    if(isCameraChosen()||load(CAMERA_INVITE_KEY)==="1"){renderCameraTab();return;}
    var copy=visitorCopy();
    var bar=document.createElement("div");bar.id="_ecx_cam_invite";
    bar.style.cssText="position:fixed;bottom:0;left:0;right:0;background:#1e293b;color:#fff;padding:12px 20px;font-family:-apple-system,sans-serif;font-size:13px;line-height:1.4;z-index:2147483647;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;box-shadow:0 -2px 10px rgba(0,0,0,0.15);";
    var text=document.createElement("span");text.style.cssText="flex:1 1 280px;";text.textContent=describeRecording(copy.activeLead)+" "+copy.invite;
    var activate=document.createElement("button");activate.type="button";activate.textContent=copy.activate;
    activate.style.cssText="background:#2563eb;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;";
    var dismiss=document.createElement("button");dismiss.type="button";dismiss.textContent=copy.dismiss;
    dismiss.style.cssText="background:transparent;color:#cbd5e1;border:1px solid #475569;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;";
    activate.onclick=activateCameraCapture;
    dismiss.onclick=function(){store(CAMERA_INVITE_KEY,"1");bar.remove();renderCameraTab();};
    var actions=document.createElement("div");actions.style.cssText="display:flex;gap:8px;";
    actions.appendChild(activate);actions.appendChild(dismiss);
    bar.appendChild(text);bar.appendChild(actions);
    document.body.appendChild(bar);
}
// FACS Action Units from face-api 68 landmarks (same formulas as the Eye Tracking module)
var AU_BASELINE_SAMPLES=10;
var AU_RULES={AU1:["innerBrowHeight",1,0.15],AU2:["outerBrowHeight",1,0.15],AU4:["browGap",-1,0.10],AU6:["eyeOpening",-1,0.06],AU12:["cornerLift",1,0.15],AU15:["cornerLift",-1,0.10],AU20:["mouthWidth",1,0.25],AU25:["lipGap",1,0.15],AU26:["jawDrop",1,0.30]};
function measureFace68(points){
    if(!points||points.length<68)return null;
    var dist=function(a,b){return Math.sqrt((points[a].x-points[b].x)*(points[a].x-points[b].x)+(points[a].y-points[b].y)*(points[a].y-points[b].y));};
    var ref=dist(39,42);
    if(ref<=0)return null;
    return{
        innerBrowHeight:(dist(21,39)+dist(22,42))/2/ref,
        outerBrowHeight:(dist(17,36)+dist(26,45))/2/ref,
        browGap:dist(21,22)/ref,
        eyeOpening:(dist(37,41)+dist(38,40)+dist(43,47)+dist(44,46))/4/ref,
        mouthWidth:dist(48,54)/ref,
        cornerLift:((points[62].y+points[66].y)/2-(points[48].y+points[54].y)/2)/ref,
        lipGap:dist(62,66)/ref,
        jawDrop:dist(33,8)/ref
    };
}
function medianOf(values){
    var sorted=values.slice().sort(function(a,b){return a-b;});
    var mid=Math.floor(sorted.length/2);
    return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
function createActionUnitEstimator(){
    var baselineSamples=[];
    return function(points){
        var measures=measureFace68(points);
        if(!measures)return null;
        if(baselineSamples.length<AU_BASELINE_SAMPLES)baselineSamples.push(measures);
        var units={};
        for(var unit in AU_RULES){
            var rule=AU_RULES[unit];
            var baseline=medianOf(baselineSamples.map(function(sample){return sample[rule[0]];}));
            units[unit]=Math.max(0,Math.min(1,rule[1]*(measures[rule[0]]-baseline)/rule[2]));
        }
        units.AU20=units.AU20*(1-units.AU12);
        return units;
    };
}
var estimateActionUnits=createActionUnitEstimator();
function roundTo3(value){return Math.round(value*1000)/1000;}
function toEmotionSample(detection,timestamp){
    var best="neutral",bestScore=0,expressions={};
    for(var key in detection.expressions){
        if(!EXPRESSION_MAP[key])continue;
        expressions[EXPRESSION_MAP[key]]=roundTo3(detection.expressions[key]);
        if(detection.expressions[key]>bestScore){bestScore=detection.expressions[key];best=EXPRESSION_MAP[key];}
    }
    var units=estimateActionUnits(detection.landmarks.positions)||{AU1:0,AU2:0,AU4:0,AU6:0,AU12:0,AU15:0,AU20:0,AU25:0,AU26:0};
    var actionUnits={};
    for(var unit in units)actionUnits[unit]=roundTo3(units[unit]);
    return{timestamp:timestamp,emotion:best,confidence:roundTo3(bestScore),expressions:expressions,actionUnits:actionUnits};
}

// Last known cursor position
var lastCursorX=0,lastCursorY=0;
document.addEventListener("mousemove",function(e){lastCursorX=e.clientX;lastCursorY=e.clientY;},true);
document.addEventListener("touchmove",function(e){var t=e.touches[0];if(t){lastCursorX=t.clientX;lastCursorY=t.clientY;}},true);

function reportCaptureError(kind,sync){
    if(!sid)return;
    try{
        var xhr=new XMLHttpRequest();
        xhr.open("POST",C.api+"/public/tracking/"+C.rid+"/capture-error",!sync);
        xhr.setRequestHeader("Content-Type","application/json");
        xhr.send(JSON.stringify({sessionId:sid,kind:kind}));
    }catch(e){}
}

var isPageLeaving=false;
window.addEventListener("pagehide",function(){isPageLeaving=true;});
window.addEventListener("pageshow",function(){isPageLeaving=false;});
function reportModelFailure(cb){
    if(!isPageLeaving)reportCaptureError("face-models-failed");
    cb();
}

var cameraWaiters=null;
function withCamera(cb){
    if(emoVideo){cb(emoStream);return;}
    if(cameraWaiters){cameraWaiters.push(cb);return;}
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){reportCaptureError("camera-unavailable");return;}
    cameraWaiters=[cb];
    navigator.mediaDevices.getUserMedia({video:{width:{ideal:320},height:{ideal:240},facingMode:"user"},audio:false})
    .then(function(stream){
        emoStream=stream;
        var v=document.createElement("video");
        v.setAttribute("autoplay","");v.setAttribute("muted","");v.setAttribute("playsinline","");
        v.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
        v.srcObject=stream;
        document.body.appendChild(v);
        emoVideo=v;
        var waiters=cameraWaiters;cameraWaiters=null;
        waiters.forEach(function(w){w(stream);});
    })
    .catch(function(err){
        cameraWaiters=null;
        reportCaptureError(err&&err.name==="NotAllowedError"?"camera-denied":"camera-unavailable");
    });
}

var cameraReleaseTimer=null;
function releaseCamera(){
    if(eyeSession){eyeSession.stop();}
    else{
        if(emoStream)emoStream.getTracks().forEach(function(t){t.stop();});
        if(emoVideo)emoVideo.remove();
    }
    eyeSession=null;emoStream=null;emoVideo=null;isCaptureStarted=false;
}

var EMO_SAMPLE_MS=50,GAZE_SAMPLE_MS=500,FIXATION_SAMPLE_MS=50;
var gazeInterval=null,fixationInterval=null,isDetectingEmotion=false,faceApiReady=false,isCaptureStarted=false;
function captureElapsedMs(){return emoActiveMs+(Date.now()-emoStartTime);}
function startSampling(){
    if(emoRunning)return;
    emoRunning=true;
    emoStartTime=Date.now();
    if(eyeSession){gazeInterval=setInterval(sampleGaze,GAZE_SAMPLE_MS);fixationInterval=setInterval(sampleFixation,FIXATION_SAMPLE_MS);}
    if(C.emotions&&faceApiReady)emoInterval=setInterval(sampleEmotion,EMO_SAMPLE_MS);
}

function beginCapture(){
    isCaptureStarted=true;
    estimateActionUnits=createActionUnitEstimator();
    startSampling();
}

var eyeSession=null,isEyeFlowOpen=false;
function pageLanguage(){return /^en/i.test(document.documentElement.lang||navigator.language||"")?"en":"es";}
function loadEye(cb){
    if(window.EmotioxEye){cb();return;}
    var sc=document.createElement("script");
    sc.src=C.eyeUrl+"?v="+Math.floor(Date.now()/3600000);
    sc.onload=cb;
    sc.onerror=function(){isEyeFlowOpen=false;reportCaptureError("mediapipe-failed");};
    document.head.appendChild(sc);
}
function startEyeTracking(){
    if(eyeSession){beginCapture();return;}
    if(isEyeFlowOpen)return;
    isEyeFlowOpen=true;
    loadEye(function(){
        window.EmotioxEye.start({
            lang:pageLanguage(),
            storageKey:EYE_CALIBRATION_KEY,
            hasEmotionRecognition:!!C.emotions,
            onReady:function(session){
                isEyeFlowOpen=false;
                eyeSession=session;emoVideo=session.video;emoStream=session.video.srcObject;
                markCameraOn();
                if(C.emotions){loadFaceApi(beginCapture);return;}
                beginCapture();
            },
            onDecline:function(){isEyeFlowOpen=false;skipCameraCapture();},
            onCameraDenied:function(){reportCaptureError("camera-denied");}
        });
    });
}

function openCameraCapture(){
    if(!hasCameraFeatures())return;
    if(C.gaze){startEyeTracking();return;}
    withCamera(function(){markCameraOn();loadFaceApi(beginCapture);});
}

function startCameraCapture(){
    if(!hasCameraFeatures()||!isCameraChosen())return;
    if(C.gaze&&!hasFreshCalibration()){store(CAMERA_CHOICE_KEY,"0");renderCameraTab();return;}
    openCameraCapture();
}

function loadFaceApi(cb){
    if(faceApiReady){cb();return;}
    var onModels=function(){
        faceapi.tf.setWasmPaths("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@"+faceapi.tf.version_core+"/dist/");
        faceapi.tf.ready().then(function(){
            return Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(C.emoModelUrl),
                faceapi.nets.faceLandmark68Net.loadFromUri(C.emoModelUrl),
                faceapi.nets.faceExpressionNet.loadFromUri(C.emoModelUrl)
            ]);
        }).then(function(){faceApiReady=true;cb();},function(){reportModelFailure(cb);});
    };
    if(window.faceapi){onModels();return;}
    var sc=document.createElement("script");
    sc.src="https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js";
    sc.onload=onModels;
    sc.onerror=function(){reportModelFailure(cb);};
    document.head.appendChild(sc);
}


function sampleEmotion(){
    if(!emoRunning||paused||isDetectingEmotion||!emoVideo||emoVideo.readyState<2)return;
    var ts=captureElapsedMs();
    if(ts>EMO_MAX_MS){stopEmotionCapture();return;}
    isDetectingEmotion=true;
    faceapi.detectSingleFace(emoVideo,new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.25}))
    .withFaceLandmarks()
    .withFaceExpressions()
    .then(function(det){if(det&&emoRunning)emoBuf.push(toEmotionSample(det,ts));})
    .catch(function(){})
    .then(function(){isDetectingEmotion=false;});
}

function rateGaze(rmsePx){return rmsePx<=80?"good":rmsePx<=150?"fair":"low";}
function sampleGaze(){
    if(!emoRunning||paused||!eyeSession)return;
    var ts=captureElapsedMs();
    if(ts>EMO_MAX_MS){stopEmotionCapture();return;}
    var gaze=eyeSession.readGaze();
    if(!eyeSession.readLandmarks()||!gaze)return;
    var pose=eyeSession.readHeadPose();
    var st=attnState(eyeSession.isEyeOpen(),pose.yaw,pose.pitch);
    var rmse=eyeSession.calibrationRmsePx||999;
    gazeBuf.push({
        timestamp:ts,
        quadrant:viewportQuadrant(gaze.x,gaze.y),
        attention:st,
        score:attnScore(st),
        cursorX:Math.round(lastCursorX),
        cursorY:Math.round(lastCursorY),
        pageX:Math.round(gaze.x+window.scrollX),
        pageY:Math.round(gaze.y+window.scrollY),
        gazeQuality:rateGaze(rmse),
        gazeRmse:Math.round(rmse)
    });
}
function sampleFixation(){
    if(!emoRunning||paused||!eyeSession||!eyeSession.isEyeOpen())return;
    var gaze=eyeSession.readGaze();
    if(!gaze)return;
    feedFixation(Math.round(gaze.x+window.scrollX),Math.round(gaze.y+window.scrollY),captureElapsedMs());
}

function stopEmotionCapture(){
    emoRunning=false;
    if(emoInterval){clearInterval(emoInterval);emoInterval=null;}
    if(gazeInterval){clearInterval(gazeInterval);gazeInterval=null;}
    if(fixationInterval){clearInterval(fixationInterval);fixationInterval=null;}
}

function flushEmotions(sync){
    if(!emoBuf.length||!sid)return;
    var batch=emoBuf.splice(0,emoBuf.length);
    var body=JSON.stringify({sessionId:sid,samples:batch});
    var url=C.api+"/public/tracking/"+C.rid+"/emotions";
    try{
        var xhr=new XMLHttpRequest();
        xhr.open("POST",url,!sync);
        xhr.setRequestHeader("Content-Type","application/json");
        xhr.send(body);
    }catch(e){}
}

function flushGaze(sync){
    if(!gazeBuf.length&&!fixBuf.length||!sid)return;
    var batch=gazeBuf.splice(0,gazeBuf.length);
    if(fixBuf.length){batch=batch.concat(fixBuf.splice(0,fixBuf.length));}
    var body=JSON.stringify({sessionId:sid,samples:batch});
    var url=C.api+"/public/tracking/"+C.rid+"/gaze";
    try{
        var xhr=new XMLHttpRequest();
        xhr.open("POST",url,!sync);
        xhr.setRequestHeader("Content-Type","application/json");
        xhr.send(body);
    }catch(e){}
}

// ─── Load rrweb ──────────────────────────────────────────────────────

function loadRrweb(cb){
    if(window.rrweb&&window.rrweb.record){cb();return;}
    var sc=document.createElement("script");
    sc.src="https://cdn.jsdelivr.net/npm/rrweb@2.0.0-alpha.4/dist/rrweb.min.js";
    sc.onload=function(){cb();};
    sc.onerror=function(){cb();};
    document.head.appendChild(sc);
}

// ─── Init ────────────────────────────────────────────────────────────

function init(){
    if(!checkDomain())return;
    if(!checkPage())return;
    if(C.sampling<100){
        var sk=load("_ecx_sample_"+C.rid);
        if(sk==="0")return;
        if(!sk){var sampled=Math.random()*100<C.sampling;store("_ecx_sample_"+C.rid,sampled?"1":"0");if(!sampled)return;}
    }
    loadRrweb(function(){
        var prev=load("_ecx_consent_"+C.rid);
        if(prev==="0"){renderResumePill();return;}
        if(prev==="1"||!C.consent){consented=true;startSession();}
        else showConsent();
    });
}

if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",init);}
else{init();}
})();`;
};

/**
 * Generates the HTML snippet tag for embedding.
 */
export const generateEmbedSnippet = (researchId: string, apiBaseUrl: string): string => {
    return `<!-- EmotioCX Web Tracker -->
<script>
(function(r,a){var s=document.createElement("script");s.async=true;
s.src=a+"/public/tracking/"+r+"/script.js?v="+Math.floor(Date.now()/60000);
document.head.appendChild(s);
})("${researchId}","${apiBaseUrl}");
</script>`;
};
