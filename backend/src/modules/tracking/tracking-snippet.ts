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
    emotionVideoEnabled: boolean;
    emotionModelBaseUrl: string;
    captureGaze: boolean;
    gazeCalibrationPoints: 5 | 9;
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
        emoVideo: config.emotionVideoEnabled,
        emoModelUrl: config.emotionModelBaseUrl,
        gaze: config.captureGaze,
        gazeCal: config.gazeCalibrationPoints,
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
    var batch=buf.splice(0,buf.length);
    var totalActive=activeMs+(activeStart>0?Date.now()-activeStart:0);
    var body=JSON.stringify({sessionId:sid,events:batch,activeDurationMs:totalActive});
    var url=C.api+"/public/tracking/"+C.rid+"/events";
    try{
        var xhr=new XMLHttpRequest();
        xhr.open("POST",url,!useBeacon); // sync on unload, async otherwise
        xhr.setRequestHeader("Content-Type","application/json");
        xhr.send(body);
    }catch(e){}
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
    if(pageStart&&Date.now()-pageStart<2000){
        push({eventType:"pageview",metadata:{friction:"speed-browsing"}});
    }
    if(sid){flush();flushRrweb();flushEmotions();flushGaze();}
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
    if(!window.rrweb||!window.rrweb.record)return;
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

            if(gazeWeights&&mpLandmarker&&emoVideo&&emoVideo.readyState>=2){
                try{
                    var tapRes=mpLandmarker.detectForVideo(emoVideo,performance.now());
                    if(tapRes.faceLandmarks&&tapRes.faceLandmarks.length&&tapRes.faceLandmarks[0].length>473){
                        var tapFeat=extractGazeFeat(tapRes.faceLandmarks[0],tapRes.facialTransformationMatrixes);
                        var nCur=calXbuf.length/gazeFeatDim;
                        if(nCur>=CAL_MAX_SAMPLES){calXbuf.splice(0,gazeFeatDim);calYbuf.splice(0,2);}
                        for(var fi=0;fi<gazeFeatDim;fi++)calXbuf.push(tapFeat[fi]);
                        calYbuf.push(e.clientX,e.clientY);
                        tapsSinceRetrain++;
                        if(tapsSinceRetrain>=TAPS_PER_RETRAIN){
                            var nAll=calXbuf.length/gazeFeatDim;
                            var newW=solveRidge(calXbuf,calYbuf,gazeFeatDim,nAll,10.0);
                            if(newW){gazeWeights=newW;oeState={x:null,dx:null,y:null,dy:null,lastT:0};store("_ecx_gaze_cal_"+C.rid,JSON.stringify({w:newW,d:gazeFeatDim,r:gazeRmsePx,t:Date.now()}));}
                            tapsSinceRetrain=0;
                        }
                    }
                }catch(te){}
            }
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
                stopEmotionCapture();flushEmoVideo();releaseCamera();
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
        stopEmotionCapture();
        flushEmotions(true);
        flushGaze(true);
        flushEmoVideo();
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
    d.style.cssText="position:fixed;"+pos+"left:0;right:0;background:#1e293b;color:#fff;padding:12px 20px;font-family:-apple-system,sans-serif;font-size:14px;z-index:2147483647;display:flex;align-items:center;justify-content:space-between;"+shadow;
    d.innerHTML='<span>'+C.cText+'</span><div><button id="_ecx_accept" style="background:#2563eb;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;margin-left:8px;font-size:13px;">'+C.cAccept+'</button><button id="_ecx_reject" style="background:transparent;color:#94a3b8;border:1px solid #475569;padding:6px 16px;border-radius:6px;cursor:pointer;margin-left:8px;font-size:13px;">'+C.cDecline+'</button></div>';
    document.body.appendChild(d);
    document.getElementById("_ecx_accept").onclick=function(){
        consented=true;d.remove();
        store("_ecx_consent_"+C.rid,"1");
        startSession();
    };
    document.getElementById("_ecx_reject").onclick=function(){
        d.remove();
        store("_ecx_consent_"+C.rid,"0");
    };
}

// ─── Start Session ───────────────────────────────────────────────────

function startSession(){
    vid=getVid();
    startCapture();
    createSession();
}

// ─── Emotion + Gaze Recognition (MediaPipe FaceLandmarker) ──────────

var emoBuf=[],gazeBuf=[],emoRunning=false,emoVideo=null,emoStream=null;
var emoChunks=[],emoActiveMs=0,emoStartTime=0;
var EMO_MAX_MS=300000; // 5 min cap
var emoInterval=null;
var mpLandmarker=null;
var EXPRESSION_MAP={happy:"joy",sad:"sadness",angry:"anger",surprised:"surprise",disgusted:"disgust",fearful:"fear",neutral:"neutral"};

// Gaze logic (inlined from tracking-gaze-logic.ts)
var GAZE_H_THRESH=0.08,GAZE_V_THRESH=0.06,HEAD_DIST_DEG=30;
function irisDisp(ix,iy,ox,oy,nx,ny,ty,by){
    var ew=Math.abs(nx-ox),eh=Math.abs(ty-by);
    if(ew<1e-5||eh<1e-5)return{rx:0,ry:0};
    return{rx:(ix-(nx+ox)/2)/ew,ry:(iy-(ty+by)/2)/eh};
}
function gazeDir(l,r){
    var ax=(l.rx+r.rx)/2,ay=(l.ry+r.ry)/2;
    return{
        h:ax<-GAZE_H_THRESH?"left":ax>GAZE_H_THRESH?"right":"center",
        v:ay<-GAZE_V_THRESH?"up":ay>GAZE_V_THRESH?"down":"center"
    };
}
function attnState(vis,yaw,pitch){
    if(!vis)return"away";
    if(Math.abs(yaw)>HEAD_DIST_DEG||Math.abs(pitch)>HEAD_DIST_DEG)return"distracted";
    return"engaged";
}
function gazeQuad(d){
    if(d.v==="center"&&d.h==="center")return"center";
    var vp=d.v==="up"?"top":d.v==="down"?"bottom":"center";
    return vp+"-"+d.h;
}
function quadProbs(l,r){
    var ax=(l.rx+r.rx)/2,ay=(l.ry+r.ry)/2;
    var QC=[[-0.16,-0.12,"top-left"],[0,-0.12,"top-center"],[0.16,-0.12,"top-right"],[-0.16,0,"center-left"],[0,0,"center"],[0.16,0,"center-right"],[-0.16,0.12,"bottom-left"],[0,0.12,"bottom-center"],[0.16,0.12,"bottom-right"]];
    var SX=GAZE_H_THRESH,SY=GAZE_V_THRESH,t=0,w={};
    for(var i=0;i<9;i++){var dx=ax-QC[i][0],dy=ay-QC[i][1];var v=Math.exp(-(dx*dx)/(2*SX*SX)-(dy*dy)/(2*SY*SY));w[QC[i][2]]=v;t+=v;}
    var p={};for(var k in w)p[k]=t>0?Math.round(w[k]/t*1000)/1000:0;
    return p;
}
function cursorMatch(g,cx,cy,vw,vh){
    if(g.h==="center"&&g.v==="center")return true;
    var ch=cx<vw/3?"left":cx>vw*2/3?"right":"center";
    var cv=cy<vh/3?"up":cy>vh*2/3?"down":"center";
    return(g.h==="center"||g.h===ch)&&(g.v==="center"||g.v===cv);
}
function attnScore(st,match){return st==="away"?0:st==="distracted"?0.3:match?1:0.7;}

// ─── Mobile Gaze Calibration (Ridge Regression + One-Euro Filter) ───
var gazeWeights=null,gazeFeatDim=9,gazeQuality="unknown",gazeRmsePx=0;
var GAZE_FEAT_DIM=9;
var calXbuf=[],calYbuf=[],tapsSinceRetrain=0,CAL_MAX_SAMPLES=30,TAPS_PER_RETRAIN=5;

function extractGazeFeat(lm,fmList){
    var li=lm[468],ri=lm[473];
    var ld=irisDisp(li.x,li.y,lm[33].x,lm[33].y,lm[133].x,lm[133].y,lm[159].y,lm[145].y);
    var rd=irisDisp(ri.x,ri.y,lm[263].x,lm[263].y,lm[362].x,lm[362].y,lm[386].y,lm[374].y);
    var ax=(ld.rx+rd.rx)/2,ay=(ld.ry+rd.ry)/2;
    var yaw=0,pitch=0;
    if(fmList&&fmList.length){var m=fmList[0];yaw=Math.asin(Math.max(-1,Math.min(1,m[2]||0)))*180/Math.PI;pitch=Math.atan2(-(m[6]||0),m[10]||1)*180/Math.PI;}
    return[ax,ay,ld.rx,ld.ry,rd.rx,rd.ry,yaw/90,pitch/90,1];
}

function solveRidge(X,Y,d,n,lambda){
    var i,j,k;
    var XtX=new Array(d*d);for(i=0;i<d*d;i++)XtX[i]=0;
    for(i=0;i<d;i++)for(j=0;j<d;j++){var s=0;for(k=0;k<n;k++)s+=X[k*d+i]*X[k*d+j];XtX[i*d+j]=s;}
    for(i=0;i<d;i++)XtX[i*d+i]+=lambda;
    var XtY=new Array(d*2);for(i=0;i<d*2;i++)XtY[i]=0;
    for(i=0;i<d;i++)for(k=0;k<n;k++){XtY[i*2]+=X[k*d+i]*Y[k*2];XtY[i*2+1]+=X[k*d+i]*Y[k*2+1];}
    var aug=new Array(d*(d+2));
    for(i=0;i<d;i++){for(j=0;j<d;j++)aug[i*(d+2)+j]=XtX[i*d+j];aug[i*(d+2)+d]=XtY[i*2];aug[i*(d+2)+d+1]=XtY[i*2+1];}
    for(i=0;i<d;i++){
        var mx=Math.abs(aug[i*(d+2)+i]),mi=i;
        for(j=i+1;j<d;j++){var v=Math.abs(aug[j*(d+2)+i]);if(v>mx){mx=v;mi=j;}}
        if(mi!==i){for(j=0;j<d+2;j++){var tmp=aug[i*(d+2)+j];aug[i*(d+2)+j]=aug[mi*(d+2)+j];aug[mi*(d+2)+j]=tmp;}}
        var piv=aug[i*(d+2)+i];if(Math.abs(piv)<1e-12)return null;
        for(j=0;j<d+2;j++)aug[i*(d+2)+j]/=piv;
        for(k=0;k<d;k++){if(k===i)continue;var f=aug[k*(d+2)+i];for(j=0;j<d+2;j++)aug[k*(d+2)+j]-=f*aug[i*(d+2)+j];}
    }
    var W=new Array(d*2);
    for(i=0;i<d;i++){W[i*2]=aug[i*(d+2)+d];W[i*2+1]=aug[i*(d+2)+d+1];}
    return W;
}

function predictXY(feat,W,d){
    var x=0,y=0;
    for(var i=0;i<d;i++){x+=feat[i]*W[i*2];y+=feat[i]*W[i*2+1];}
    return[x,y];
}

// One-Euro adaptive filter (Casiez et al. 2012)
var oeState={x:null,dx:null,y:null,dy:null,lastT:0};
var OE_MIN_CUTOFF=0.6,OE_BETA=0.007,OE_D_CUTOFF=1.0;
function oeAlpha(cutoff,dt){var tau=1/(2*Math.PI*cutoff);return 1/(1+tau/dt);}
function oeFilter(val,prev,prevD,dt,isX){
    if(prev===null)return{v:val,d:0};
    var ad=oeAlpha(OE_D_CUTOFF,dt);
    var dv=(val-prev)/dt;
    var ed=ad*dv+(1-ad)*prevD;
    var cutoff=OE_MIN_CUTOFF+OE_BETA*Math.abs(ed);
    var a=oeAlpha(cutoff,dt);
    return{v:a*val+(1-a)*prev,d:ed};
}
function applyOneEuro(x,y){
    var now=performance.now()/1000;
    var dt=oeState.lastT>0?now-oeState.lastT:1/30;
    if(dt<=0)dt=1/30;
    var fx=oeFilter(x,oeState.x,oeState.dx,dt);
    var fy=oeFilter(y,oeState.y,oeState.dy,dt);
    oeState.x=fx.v;oeState.dx=fx.d;oeState.y=fy.v;oeState.dy=fy.d;oeState.lastT=now;
    return[Math.round(fx.v),Math.round(fy.v)];
}

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

function calPoints(n){
    if(n===5)return[[50,15],[10,85],[90,85],[10,15],[90,15]];
    return[[10,10],[50,10],[90,10],[10,50],[50,50],[90,50],[10,90],[50,90],[90,90]];
}

// ─── Participant camera screens (same flow, copy and thresholds as the Eye Tracking module) ───
var UI_TEXTS={
    es:{step:"Paso {step} de {total}: {label}",stepPrepare:"Prepararse",stepCalibrate:"Ajustar la mirada",stepCheck:"Comprobar",
        qgTitle:"Revisando tu cámara...",qgSubtitle:"Toma unos segundos. Quédate quieto/a mirando la pantalla.",qgRetry:"Intentar de nuevo",qgPassed:"¡Todo bien! Seguimos...",
        resolution:"Cámara funcionando",brightness:"Buena luz",faceDetection:"Se ve tu cara",distance:"Distancia correcta",headStability:"Cabeza quieta",headPose:"Mirando de frente",
        hintResolution:"Revisa que la cámara no esté tapada",hintBrightness:"Busca un lugar con más luz, sin ventanas ni lámparas detrás de ti",hintFaceDetection:"Pon tu cara frente a la cámara",
        hintDistance:"Acércate o aléjate un poco: más o menos a un brazo de distancia",hintHeadStability:"Quédate quieto/a unos segundos",hintHeadPose:"Mira la pantalla de frente",
        dwell:"Mira el punto sin mover la cabeza. Avanzará solo.",pointOf:"Punto {current} de {total}",tapFallback:"si no avanza, toca la pantalla o haz clic",
        failed:"No logramos ajustar bien tu mirada. En el próximo intento, mueve solo los ojos, no la cabeza. ¿Lo intentamos otra vez?",
        rejected:"Después de varios intentos no logramos ajustar tu mirada. Puedes seguir igual o saltar esta actividad.",
        retry:"Intentar de nuevo",continueAnyway:"Seguir igual",skip:"Saltar esta actividad"},
    en:{step:"Step {step} of {total}: {label}",stepPrepare:"Get ready",stepCalibrate:"Adjust your gaze",stepCheck:"Check",
        qgTitle:"Checking your camera...",qgSubtitle:"This takes a few seconds. Stay still and look at the screen.",qgRetry:"Try again",qgPassed:"All good! Moving on...",
        resolution:"Camera working",brightness:"Good light",faceDetection:"We can see your face",distance:"Right distance",headStability:"Head still",headPose:"Facing the screen",
        hintResolution:"Check that the camera is not covered",hintBrightness:"Find a brighter place, with no windows or lamps behind you",hintFaceDetection:"Put your face in front of the camera",
        hintDistance:"Move a little closer or farther: about an arm's length away",hintHeadStability:"Stay still for a few seconds",hintHeadPose:"Look straight at the screen",
        dwell:"Look at the dot without moving your head. It will move on by itself.",pointOf:"Point {current} of {total}",tapFallback:"if it does not move, tap or click the screen",
        failed:"We could not adjust to your gaze well. Next time, move only your eyes, not your head. Shall we try again?",
        rejected:"After several tries we could not adjust to your gaze. You can continue anyway or skip this activity.",
        retry:"Try again",continueAnyway:"Continue anyway",skip:"Skip this activity"}
};
var UI_TEXT=UI_TEXTS[/^en/i.test(navigator.language||"")?"en":"es"];
function uiText(key,vars){
    var text=UI_TEXT[key];
    for(var name in vars||{})text=text.split("{"+name+"}").join(String(vars[name]));
    return text;
}

var UI_FONT="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
var UI_STEP_LABELS=["stepPrepare","stepCalibrate","stepCheck"];
function uiNode(tag,css,text){
    var node=document.createElement(tag);
    node.style.cssText=css;
    if(text!=null)node.textContent=text;
    return node;
}
function uiOverlay(background){
    return uiNode("div","position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;box-sizing:border-box;padding:max(16px,env(safe-area-inset-top)) 24px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;"+UI_FONT+"background:"+background+";");
}
function uiPill(step,percent){
    var pill=uiNode("div","display:inline-flex;align-items:center;gap:12px;background:#2563eb;color:#fff;padding:8px 16px;border-radius:999px;font-size:14px;font-weight:500;");
    pill.appendChild(uiNode("span","",uiText("step",{step:step,total:UI_STEP_LABELS.length,label:uiText(UI_STEP_LABELS[step-1])})));
    var track=uiNode("div","width:64px;height:6px;background:#60a5fa;border-radius:999px;overflow:hidden;");
    var fill=uiNode("div","height:100%;background:#fff;border-radius:999px;transition:width .3s;");
    track.appendChild(fill);
    pill.appendChild(track);
    pill.setPercent=function(value){fill.style.width=Math.min(Math.round(value),100)+"%";};
    pill.setPercent(percent);
    return pill;
}
function uiButton(label,isPrimary,onClick){
    var button=uiNode("button","border:0;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:500;cursor:pointer;"+UI_FONT+(isPrimary?"background:#2563eb;color:#fff;":"background:rgba(255,255,255,0.2);color:#fff;"),label);
    button.addEventListener("click",function(e){e.stopPropagation();onClick();});
    return button;
}
function uiSkipButton(overlay){
    var button=uiButton(uiText("skip"),false,function(){overlay.remove();skipCameraCapture();});
    button.style.background="#f3f4f6";button.style.color="#4b5563";
    return button;
}
function uiDot(color,size){
    var dot=uiNode("div","position:absolute;width:"+size+"px;height:"+size+"px;transform:translate(-50%,-50%);transition:left .3s ease,top .3s ease;pointer-events:none;");
    var mask="radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px))";
    var ring=uiNode("div","position:absolute;left:-10px;top:-10px;right:-10px;bottom:-10px;border-radius:50%;-webkit-mask:"+mask+";mask:"+mask+";");
    dot.appendChild(uiNode("div","position:absolute;left:0;top:0;right:0;bottom:0;border-radius:50%;background:"+color+";box-shadow:0 0 16px "+color+";"));
    dot.appendChild(ring);
    dot.moveTo=function(xPct,yPct){dot.style.left=xPct+"%";dot.style.top=yPct+"%";};
    dot.setProgress=function(fraction){ring.style.background=fraction>0?"conic-gradient("+color+" "+Math.round(fraction*360)+"deg,transparent 0)":"transparent";};
    return dot;
}

function headPose(matrixes){
    if(!matrixes||!matrixes.length)return{yaw:0,pitch:0};
    var m=matrixes[0];
    return{yaw:Math.asin(Math.max(-1,Math.min(1,m[2]||0)))*180/Math.PI,pitch:Math.atan2(-(m[6]||0),m[10]||1)*180/Math.PI};
}
function readFace(){
    if(!mpLandmarker||!emoVideo||emoVideo.readyState<2)return null;
    try{
        var res=mpLandmarker.detectForVideo(emoVideo,performance.now());
        if(!res.faceLandmarks||!res.faceLandmarks.length||res.faceLandmarks[0].length<=473)return null;
        return{landmarks:res.faceLandmarks[0],matrixes:res.facialTransformationMatrixes};
    }catch(e){return null;}
}

var QUALITY_CHECK_IDS=["resolution","brightness","faceDetection","distance","headStability","headPose"];
var QUALITY_FRAMES=30,QUALITY_TICK_MS=40,INTERPUPILLARY_MM=63;
function rateCameraQuality(m){
    var backlit=m.edgeBrightness>m.centerBrightness*1.8&&m.centerBrightness<100;
    return{
        resolution:m.width>=640&&m.height>=480?"pass":"fail",
        brightness:m.brightness<60?"fail":m.brightness<80||backlit?"warn":"pass",
        faceDetection:m.faceRatio>=0.8?"pass":"fail",
        distance:m.distanceCm<45||m.distanceCm>75?"warn":"pass",
        headStability:m.headSpreadPx>15?"fail":"pass",
        headPose:m.headAngleDeg>25?"fail":m.headAngleDeg>15?"warn":"pass"
    };
}
function measureLight(video){
    var w=64,h=48,canvas=document.createElement("canvas");
    canvas.width=w;canvas.height=h;
    var ctx=canvas.getContext("2d",{willReadFrequently:true});
    if(!ctx)return{average:128,center:128,edge:128};
    ctx.drawImage(video,0,0,w,h);
    var data=ctx.getImageData(0,0,w,h).data,sum=0,centerSum=0,centerCount=0,edgeSum=0,edgeCount=0;
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
        var i=(y*w+x)*4,lum=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
        sum+=lum;
        if(x>w*0.25&&x<w*0.75&&y>h*0.15&&y<h*0.85){centerSum+=lum;centerCount++;}else{edgeSum+=lum;edgeCount++;}
    }
    return{average:sum/(w*h),center:centerCount?centerSum/centerCount:128,edge:edgeCount?edgeSum/edgeCount:128};
}
function positionSpread(points){
    if(points.length<2)return 999;
    var mx=0,my=0,total=0;
    points.forEach(function(p){mx+=p.x;my+=p.y;});
    mx/=points.length;my/=points.length;
    points.forEach(function(p){total+=(p.x-mx)*(p.x-mx)+(p.y-my)*(p.y-my);});
    return Math.sqrt(total/points.length);
}
function collectCameraMetrics(cb){
    var ticks=0,faces=0,noses=[],eyeGaps=[],headAngle=0;
    var timer=setInterval(function(){
        if(!emoVideo){clearInterval(timer);cb(null);return;}
        ticks++;
        var face=readFace();
        if(face){
            var lm=face.landmarks,pose=headPose(face.matrixes);
            faces++;
            noses.push({x:lm[1].x*emoVideo.videoWidth,y:lm[1].y*emoVideo.videoHeight});
            eyeGaps.push(Math.sqrt(Math.pow(lm[468].x-lm[473].x,2)+Math.pow(lm[468].y-lm[473].y,2)));
            headAngle=Math.max(Math.abs(pose.yaw),Math.abs(pose.pitch));
        }
        if(ticks<QUALITY_FRAMES)return;
        clearInterval(timer);
        eyeGaps.sort(function(a,b){return a-b;});
        var light=measureLight(emoVideo);
        cb({width:emoVideo.videoWidth,height:emoVideo.videoHeight,brightness:light.average,centerBrightness:light.center,edgeBrightness:light.edge,
            faceRatio:faces/ticks,distanceCm:eyeGaps.length?INTERPUPILLARY_MM/10/eyeGaps[Math.floor(eyeGaps.length/2)]:999,
            headSpreadPx:positionSpread(noses),headAngleDeg:headAngle});
    },QUALITY_TICK_MS);
}
function uiQualityRow(id){
    var row=uiNode("div","display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;");
    var icon=uiNode("span","width:16px;font-size:16px;color:#9ca3af;","…");
    var body=uiNode("div","flex:1;");
    var hint=uiNode("div","display:none;margin-top:4px;font-size:12px;color:#4b5563;",uiText("hint"+id.charAt(0).toUpperCase()+id.slice(1)));
    body.appendChild(uiNode("div","font-size:14px;font-weight:500;color:#1f2937;",uiText(id)));
    body.appendChild(hint);
    row.appendChild(icon);row.appendChild(body);
    var looks={pass:["✓","#22c55e","#f0fdf4","#bbf7d0"],warn:["!","#f59e0b","#fffbeb","#fde68a"],fail:["✗","#ef4444","#fef2f2","#fecaca"]};
    return{node:row,show:function(status){
        var look=looks[status];
        icon.textContent=look[0];icon.style.color=look[1];
        row.style.background=look[2];row.style.borderColor=look[3];
        hint.style.display=status==="pass"?"none":"block";
    }};
}
function runCameraCheck(onPass){
    var overlay=uiOverlay("#fff");
    overlay.appendChild(uiPill(1,20));
    overlay.appendChild(uiNode("div","margin-top:32px;font-size:20px;font-weight:700;color:#111827;",uiText("qgTitle")));
    overlay.appendChild(uiNode("div","margin-top:8px;font-size:14px;color:#6b7280;",uiText("qgSubtitle")));
    var list=uiNode("div","margin-top:24px;width:100%;max-width:448px;display:flex;flex-direction:column;gap:12px;text-align:left;");
    var footer=uiNode("div","margin-top:24px;font-size:14px;");
    overlay.appendChild(list);overlay.appendChild(footer);
    document.body.appendChild(overlay);
    function check(){
        list.textContent="";footer.textContent="";
        var rows={};
        QUALITY_CHECK_IDS.forEach(function(id){rows[id]=uiQualityRow(id);list.appendChild(rows[id].node);});
        collectCameraMetrics(function(metrics){
            if(!metrics){overlay.remove();return;}
            var ratings=rateCameraQuality(metrics),allPass=true;
            QUALITY_CHECK_IDS.forEach(function(id){rows[id].show(ratings[id]);if(ratings[id]!=="pass")allPass=false;});
            if(allPass){
                footer.appendChild(uiNode("div","color:#16a34a;font-weight:500;",uiText("qgPassed")));
                setTimeout(function(){overlay.remove();onPass();},1500);
                return;
            }
            var actions=uiNode("div","display:flex;gap:12px;justify-content:center;");
            actions.appendChild(uiButton(uiText("qgRetry"),true,check));
            actions.appendChild(uiSkipButton(overlay));
            footer.appendChild(actions);
        });
    }
    check();
}

var CAL_POINT_MS=2500,CAL_SETTLE_MS=800,CAL_TICK_MS=40;
function runCalibration(nPts,cb){
    var pts=calPoints(nPts),d=GAZE_FEAT_DIM,Xbuf=[],Ybuf=[];
    var overlay=uiOverlay("#fff");
    var pill=uiPill(2,25);
    var counter=uiNode("div","margin-top:4px;font-size:14px;color:#6b7280;");
    var area=uiNode("div","position:relative;flex:1;width:100%;");
    var dot=uiDot("#22c55e",40);
    overlay.appendChild(pill);
    overlay.appendChild(uiNode("div","margin-top:8px;font-size:18px;font-weight:700;color:#111827;",uiText("dwell")));
    overlay.appendChild(counter);
    overlay.appendChild(area);
    overlay.appendChild(uiSkipButton(overlay));
    area.appendChild(dot);
    document.body.appendChild(overlay);
    var pIdx=0;
    function showPoint(){
        if(pIdx>=pts.length){
            var nSamples=Xbuf.length/d;
            overlay.remove();
            cb(nSamples>=3?solveRidge(Xbuf,Ybuf,d,nSamples,10.0):null,d,Xbuf.slice(),Ybuf.slice());
            return;
        }
        var px=pts[pIdx][0],py=pts[pIdx][1],frames=[],faceSince=null;
        dot.moveTo(px,py);dot.setProgress(0);
        counter.textContent=uiText("pointOf",{current:pIdx+1,total:pts.length});
        pill.setPercent(25+pIdx/pts.length*50);
        var timer=setInterval(function(){
            if(!emoVideo){clearInterval(timer);overlay.remove();return;}
            var face=readFace();
            if(!face){faceSince=null;frames=[];dot.setProgress(0);return;}
            var now=Date.now();
            if(faceSince===null)faceSince=now;
            var held=now-faceSince;
            dot.setProgress(Math.min(held/CAL_POINT_MS,1));
            if(held>=CAL_SETTLE_MS)frames.push(extractGazeFeat(face.landmarks,face.matrixes));
            if(held<CAL_POINT_MS)return;
            clearInterval(timer);
            var avg=new Array(d);
            for(var i=0;i<d;i++){var s=0;for(var j=0;j<frames.length;j++)s+=frames[j][i];avg[i]=s/frames.length;}
            avg[d-1]=1;
            var rect=area.getBoundingClientRect();
            for(var k=0;k<d;k++)Xbuf.push(avg[k]);
            Ybuf.push(rect.left+rect.width*px/100,rect.top+rect.height*py/100);
            pIdx++;
            setTimeout(showPoint,400);
        },CAL_TICK_MS);
    }
    setTimeout(showPoint,800);
}

var VALIDATION_POINTS=[[25,25],[75,25],[50,50],[25,75],[75,75]];
var VALIDATION_DWELL_MS=800,VALIDATION_PROXIMITY_PX=280,VALIDATION_GRACE_MS=250;
var RECALIBRATION_RMSE_PX=150,REJECT_RMSE_PX=200;
function decideCalibration(rmse,recalibrations){
    if(rmse<=RECALIBRATION_RMSE_PX)return"accept";
    return recalibrations>=2&&rmse>REJECT_RMSE_PX?"offer-skip":"offer-retry";
}
function runValidation(W,d,recalibrations,onChoice){
    var overlay=uiOverlay("rgba(0,0,0,0.6)");
    overlay.style.backdropFilter="blur(12px)";
    overlay.style.webkitBackdropFilter="blur(12px)";
    var pill=uiPill(3,75);
    var message=uiNode("div","margin-top:16px;max-width:512px;font-size:14px;color:rgba(255,255,255,0.8);",uiText("dwell"));
    var hint=uiNode("div","margin-top:4px;font-size:12px;color:rgba(255,255,255,0.5);");
    var actions=uiNode("div","margin-top:12px;display:flex;gap:12px;justify-content:center;");
    var dot=uiDot("#facc15",24);
    overlay.appendChild(pill);overlay.appendChild(message);overlay.appendChild(hint);overlay.appendChild(actions);overlay.appendChild(dot);
    document.body.appendChild(overlay);
    var idx=0,errors=[],dwellStart=null,exitAt=null,samples=[],lastGaze=null,timer=null;
    function target(i){return[window.innerWidth*VALIDATION_POINTS[i][0]/100,window.innerHeight*VALIDATION_POINTS[i][1]/100];}
    function showPoint(){
        dot.moveTo(VALIDATION_POINTS[idx][0],VALIDATION_POINTS[idx][1]);dot.setProgress(0);
        hint.textContent=uiText("pointOf",{current:idx+1,total:VALIDATION_POINTS.length})+" — "+uiText("tapFallback");
        pill.setPercent(75+idx/VALIDATION_POINTS.length*25);
    }
    function finish(rmse){
        clearInterval(timer);
        overlay.removeEventListener("click",onTap);
        dot.remove();hint.textContent="";
        var decision=decideCalibration(rmse,recalibrations);
        if(decision==="accept"){overlay.remove();onChoice("accept",rmse);return;}
        message.style.color="#fff";message.style.fontWeight="500";
        message.textContent=uiText(decision==="offer-skip"?"rejected":"failed");
        var choices=decision==="offer-skip"?[["continueAnyway",true,"accept"],["skip",false,"skip"]]:[["retry",true,"retry"],["continueAnyway",false,"accept"]];
        choices.forEach(function(c){actions.appendChild(uiButton(uiText(c[0]),c[1],function(){overlay.remove();onChoice(c[2],rmse);}));});
    }
    function record(x,y){
        var t=target(idx);
        errors.push(Math.sqrt(Math.pow(t[0]-x,2)+Math.pow(t[1]-y,2)));
        dwellStart=null;exitAt=null;samples=[];
        idx++;
        if(idx<VALIDATION_POINTS.length){showPoint();return;}
        finish(Math.round(Math.sqrt(errors.reduce(function(s,e){return s+e*e;},0)/errors.length)));
    }
    function onTap(){if(lastGaze)record(lastGaze[0],lastGaze[1]);}
    if(!W){finish(999);return;}
    overlay.addEventListener("click",onTap);
    showPoint();
    timer=setInterval(function(){
        if(!emoVideo){clearInterval(timer);overlay.remove();return;}
        var face=readFace(),now=Date.now();
        lastGaze=face?predictXY(extractGazeFeat(face.landmarks,face.matrixes),W,d):null;
        var t=target(idx);
        if(lastGaze&&Math.sqrt(Math.pow(t[0]-lastGaze[0],2)+Math.pow(t[1]-lastGaze[1],2))<=VALIDATION_PROXIMITY_PX){
            exitAt=null;
            if(dwellStart===null){dwellStart=now;samples=[];}
            samples.push(lastGaze);
            dot.setProgress(Math.min((now-dwellStart)/VALIDATION_DWELL_MS,1));
            if(now-dwellStart<VALIDATION_DWELL_MS)return;
            var sx=0,sy=0;
            samples.forEach(function(p){sx+=p[0];sy+=p[1];});
            record(sx/samples.length,sy/samples.length);
            return;
        }
        if(dwellStart===null)return;
        if(exitAt===null){exitAt=now;return;}
        if(now-exitAt>VALIDATION_GRACE_MS){dwellStart=null;exitAt=null;samples=[];dot.setProgress(0);}
    },CAL_TICK_MS);
}

var CAMERA_SKIP_KEY="_ecx_cam_skip_"+C.rid,CAMERA_SKIP_MS=600000;
function isCameraSkipped(){
    var skippedAt=Number(load(CAMERA_SKIP_KEY));
    return skippedAt>0&&Date.now()-skippedAt<CAMERA_SKIP_MS;
}
function skipCameraCapture(){
    store(CAMERA_SKIP_KEY,String(Date.now()));
    stopEmotionCapture();flushEmoVideo();releaseCamera();
}
function calibrateGaze(recalibrations){
    runCalibration(C.gazeCal,function(W,d,xBuf,yBuf){
        runValidation(W,d,recalibrations,function(choice,rmse){
            if(choice==="retry"){calibrateGaze(recalibrations+1);return;}
            if(choice==="skip"){skipCameraCapture();return;}
            onCalDone(W,d,rmse,xBuf,yBuf);
        });
    });
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

function reportCaptureError(kind){
    if(!sid)return;
    try{
        var xhr=new XMLHttpRequest();
        xhr.open("POST",C.api+"/public/tracking/"+C.rid+"/capture-error",true);
        xhr.setRequestHeader("Content-Type","application/json");
        xhr.send(JSON.stringify({sessionId:sid,kind:kind}));
    }catch(e){}
}

var cameraWaiters=null;
function withCamera(cb){
    if(emoVideo){cb(emoStream);return;}
    if(cameraWaiters){cameraWaiters.push(cb);return;}
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){reportCaptureError("camera-unavailable");return;}
    cameraWaiters=[cb];
    var sizes=C.gaze?[[1280,720],[640,480]]:[[320,240]];
    function attach(stream){
        emoStream=stream;
        var v=document.createElement("video");
        v.setAttribute("autoplay","");v.setAttribute("muted","");v.setAttribute("playsinline","");
        v.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
        v.srcObject=stream;
        document.body.appendChild(v);
        emoVideo=v;
        var waiters=cameraWaiters;cameraWaiters=null;
        waiters.forEach(function(w){w(stream);});
    }
    function fail(err){
        cameraWaiters=null;
        reportCaptureError(err&&err.name==="NotAllowedError"?"camera-denied":"camera-unavailable");
    }
    function openAtSize(i){
        navigator.mediaDevices.getUserMedia({video:{width:{ideal:sizes[i][0]},height:{ideal:sizes[i][1]},facingMode:"user"},audio:false})
        .then(attach)
        .catch(function(err){
            if(err&&err.name==="NotAllowedError"||i+1>=sizes.length){fail(err);return;}
            openAtSize(i+1);
        });
    }
    openAtSize(0);
}

var cameraReleaseTimer=null;
function releaseCamera(){
    if(emoStream)emoStream.getTracks().forEach(function(t){t.stop();});
    if(emoVideo)emoVideo.remove();
    emoStream=null;emoVideo=null;isCaptureStarted=false;
}

var EMO_SAMPLE_MS=50,GAZE_SAMPLE_MS=500;
var gazeInterval=null,isDetectingEmotion=false,faceApiReady=false,isCaptureStarted=false;
function captureElapsedMs(){return emoActiveMs+(Date.now()-emoStartTime);}
function startSampling(){
    if(emoRunning)return;
    emoRunning=true;
    emoStartTime=Date.now();
    if(mpLandmarker)gazeInterval=setInterval(sampleGaze,GAZE_SAMPLE_MS);
    if(C.emotions&&faceApiReady)emoInterval=setInterval(sampleEmotion,EMO_SAMPLE_MS);
}

function beginCapture(){
    isCaptureStarted=true;
    estimateActionUnits=createActionUnitEstimator();
    startSampling();
    if(C.emotions&&C.emoVideo&&emoStream)startEmoRecording(emoStream);
}

function startCameraCapture(){
    if(!(C.emotions||C.gaze)||isCameraSkipped())return;
    withCamera(function(){
        loadCaptureModels(function(){
            if(C.gaze&&mpLandmarker&&!restoreCalibration()){runCameraCheck(function(){calibrateGaze(0);});return;}
            beginCapture();
        });
    });
}

function onCalDone(W,d,rmse,xBuf,yBuf){
    gazeWeights=W;gazeFeatDim=d;gazeRmsePx=rmse||999;
    gazeQuality=rmse<=80?"good":rmse<=150?"fair":"low";
    oeState={x:null,dx:null,y:null,dy:null,lastT:0};
    if(xBuf&&yBuf){calXbuf=xBuf;calYbuf=yBuf;}
    tapsSinceRetrain=0;
    if(W)store("_ecx_gaze_cal_"+C.rid,JSON.stringify({w:W,d:d,r:rmse,t:Date.now()}));
    beginCapture();
}

function restoreCalibration(){
    var cached=load("_ecx_gaze_cal_"+C.rid);
    if(!cached)return false;
    try{
        var c=JSON.parse(cached);
        if(Date.now()-c.t>=600000)return false;
        gazeWeights=c.w;gazeFeatDim=c.d;gazeRmsePx=c.r||999;gazeQuality=c.r<=80?"good":c.r<=150?"fair":"low";
        return true;
    }catch(e){return false;}
}

function loadCaptureModels(cb){
    var pending=(C.gaze?1:0)+(C.emotions?1:0);
    var done=function(){pending--;if(pending===0)cb();};
    if(C.gaze)loadMediaPipe(done);
    if(C.emotions)loadFaceApi(done);
}

function loadMediaPipe(cb){
    if(mpLandmarker){cb();return;}
    var base="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32";
    import(base+"/vision_bundle.mjs")
    .then(function(vision){
        return vision.FilesetResolver.forVisionTasks(base+"/wasm")
        .then(function(fs){
            return vision.FaceLandmarker.createFromOptions(fs,{
                baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",delegate:"GPU"},
                runningMode:"VIDEO",numFaces:1,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:true
            });
        });
    })
    .then(function(lm){mpLandmarker=lm;cb();})
    .catch(function(){reportCaptureError("mediapipe-failed");cb();});
}

function loadFaceApi(cb){
    if(faceApiReady){cb();return;}
    var onModels=function(){
        Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(C.emoModelUrl),
            faceapi.nets.faceLandmark68Net.loadFromUri(C.emoModelUrl),
            faceapi.nets.faceExpressionNet.loadFromUri(C.emoModelUrl)
        ]).then(function(){faceApiReady=true;cb();},function(){reportCaptureError("face-models-failed");cb();});
    };
    if(window.faceapi){onModels();return;}
    var sc=document.createElement("script");
    sc.src="https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js";
    sc.onload=onModels;
    sc.onerror=function(){reportCaptureError("face-models-failed");cb();};
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

function sampleGaze(){
    if(!emoRunning||paused||!emoVideo||emoVideo.readyState<2)return;
    var ts=captureElapsedMs();
    if(ts>EMO_MAX_MS){stopEmotionCapture();return;}
    try{
        var res=mpLandmarker.detectForVideo(emoVideo,performance.now());
        if(!res.faceLandmarks||!res.faceLandmarks.length)return;
        var lm=res.faceLandmarks[0];
        if(lm.length>473){
            var li=lm[468],ri=lm[473];
            var ld=irisDisp(li.x,li.y,lm[33].x,lm[33].y,lm[133].x,lm[133].y,lm[159].y,lm[145].y);
            var rd=irisDisp(ri.x,ri.y,lm[263].x,lm[263].y,lm[362].x,lm[362].y,lm[386].y,lm[374].y);
            var gd=gazeDir(ld,rd);
            var irisVis=li.x>0&&ri.x>0;

            // Head pose from facial transformation matrix
            var yaw=0,pitch=0;
            if(res.facialTransformationMatrixes&&res.facialTransformationMatrixes.length){
                var m=res.facialTransformationMatrixes[0];
                yaw=Math.asin(Math.max(-1,Math.min(1,m[2]||0)))*180/Math.PI;
                pitch=Math.atan2(-(m[6]||0),m[10]||1)*180/Math.PI;
            }

            var st=attnState(irisVis,yaw,pitch);
            var vw=window.innerWidth,vh=window.innerHeight;
            var gpx,gpy,cm,score;
            if(gazeWeights){
                var feat=extractGazeFeat(lm,res.facialTransformationMatrixes);
                var rawPred=predictXY(feat,gazeWeights,gazeFeatDim);
                var filtered=applyOneEuro(Math.max(0,Math.min(rawPred[0],vw)),Math.max(0,Math.min(rawPred[1],vh)));
                gpx=filtered[0]+Math.round(window.scrollX);
                gpy=filtered[1]+Math.round(window.scrollY);
                cm=true;
                score=attnScore(st,true);
            }else{
                cm=cursorMatch(gd,lastCursorX,lastCursorY,vw,vh);
                score=attnScore(st,cm);
                gpx=Math.round(lastCursorX+window.scrollX);
                gpy=Math.round(lastCursorY+window.scrollY);
            }

            var sample={
                timestamp:ts,
                quadrant:gazeQuad(gd),
                quadrantProbs:quadProbs(ld,rd),
                attention:st,
                score:Math.round(score*100)/100,
                cursorX:Math.round(lastCursorX),
                cursorY:Math.round(lastCursorY),
                pageX:gpx,
                pageY:gpy
            };
            if(gazeWeights){sample.gazeQuality=gazeQuality;sample.gazeRmse=Math.round(gazeRmsePx);feedFixation(gpx,gpy,ts);}
            gazeBuf.push(sample);
        }
    }catch(e){}
}

function startEmoRecording(stream){
    try{
        var mr=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp8"});
        emoChunks=[];
        mr.ondataavailable=function(e){if(e.data.size>0)emoChunks.push(e.data);};
        mr.start(1000);
        emoVideo._recorder=mr;
    }catch(e){}
}

function stopEmotionCapture(){
    emoRunning=false;
    if(emoInterval){clearInterval(emoInterval);emoInterval=null;}
    if(gazeInterval){clearInterval(gazeInterval);gazeInterval=null;}
    if(emoVideo&&emoVideo._recorder){
        try{emoVideo._recorder.stop();}catch(e){}
    }
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

function flushEmoVideo(){
    if(!emoChunks.length||!sid||!C.emoVideo)return;
    var blob=new Blob(emoChunks,{type:"video/webm"});
    emoChunks=[];
    var sessionId=sid;
    // Convert to base64 and POST (best-effort, async)
    var reader=new FileReader();
    reader.onloadend=function(){
        var b64=reader.result.split(",")[1];
        if(!b64||b64.length>20971520)return; // 15MB cap
        var body=JSON.stringify({sessionId:sessionId,video:b64});
        var url=C.api+"/public/tracking/"+C.rid+"/emotion-video";
        try{
            var xhr=new XMLHttpRequest();
            xhr.open("POST",url,true);
            xhr.setRequestHeader("Content-Type","application/json");
            xhr.send(body);
        }catch(e){}
    };
    reader.readAsDataURL(blob);
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
        if(C.consent){
            var prev=load("_ecx_consent_"+C.rid);
            if(prev==="1"){consented=true;startSession();}
            else if(prev==="0")return;
            else showConsent();
        }else{
            consented=true;
            startSession();
        }
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
