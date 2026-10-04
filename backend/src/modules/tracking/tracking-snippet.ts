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
}

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
    var batch=buf.splice(0,C.max);
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
    if(buf.length>0)setTimeout(flush,100);
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
    if(sid){flush();flushRrweb();}
    sid=null;
    pageStart=Date.now();
    activeMs=0;
    activeStart=Date.now();
    paused=false;

    // Stop previous rrweb recording
    if(rrwebStopFn){try{rrwebStopFn();}catch(e){}rrwebStopFn=null;}
    rrwebActiveMs=0;

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
        startEmotionCapture();
        startGazeCapture();
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

            if(isMobile&&gazeWeights&&mpLandmarker&&emoVideo&&emoVideo.readyState>=2){
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
        }else{
            // Tab regained focus
            var away=Date.now()-hiddenAt;
            if(away>30000){
                // Away >30s — start fresh session (old one already flushed)
                stopEmotionCapture();flushEmoVideo();
                createSession();
            }else{
                // Brief switch — resume existing session
                paused=false;
                activeStart=Date.now();
                startRrwebRecording();
                if((C.emotions||C.gaze&&isMobile&&gazeWeights)&&emoStream&&!emoRunning){emoRunning=true;emoStartTime=Date.now();emoInterval=setInterval(sampleFrame,500);}
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
        fixBuf.push({type:"fixation",x:Math.round(fixState.sumX/fixState.count),y:Math.round(fixState.sumY/fixState.count),duration:Math.round(dur),timestamp:fixState.startT});
    }
    fixState={cx:x,cy:y,startT:ts,sumX:x,sumY:y,count:1,active:true};
}

function calPoints(n){
    if(n===5)return[[50,15],[10,85],[90,85],[10,15],[90,15]];
    return[[10,10],[50,10],[90,10],[10,50],[50,50],[90,50],[10,90],[50,90],[90,90]];
}

function runCalibration(nPts,cb,retryCount){
    if(!retryCount)retryCount=0;
    var pts=calPoints(nPts);
    var d=GAZE_FEAT_DIM;
    var Xbuf=[],Ybuf=[];
    var overlay=document.createElement("div");
    overlay.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:2147483647;display:flex;align-items:center;justify-content:center;flex-direction:column;";
    var dot=document.createElement("div");
    dot.style.cssText="width:20px;height:20px;border-radius:50%;background:#ef4444;position:absolute;transition:all 0.3s ease;box-shadow:0 0 16px rgba(239,68,68,0.5);";
    var ring=document.createElement("div");
    ring.style.cssText="width:36px;height:36px;border-radius:50%;border:2px solid rgba(239,68,68,0.3);position:absolute;transition:all 0.3s ease;pointer-events:none;";
    var label=document.createElement("div");
    label.style.cssText="color:#fff;font-family:-apple-system,sans-serif;font-size:15px;position:absolute;bottom:50px;text-align:center;width:100%;opacity:0.9;";
    label.textContent="Look at the red dot";
    var progress=document.createElement("div");
    progress.style.cssText="position:absolute;bottom:20px;left:10%;width:80%;height:3px;background:rgba(255,255,255,0.15);border-radius:2px;";
    var progressBar=document.createElement("div");
    progressBar.style.cssText="height:100%;background:#ef4444;border-radius:2px;transition:width 0.3s ease;width:0%;";
    progress.appendChild(progressBar);
    overlay.appendChild(dot);overlay.appendChild(ring);overlay.appendChild(label);overlay.appendChild(progress);
    document.body.appendChild(overlay);

    var pIdx=0;
    function showPoint(){
        if(pIdx>=pts.length){
            var nSamples=Xbuf.length/d;
            if(nSamples<3){overlay.remove();cb(null,d,999);return;}
            var holdIdx=nSamples-1;
            var trainX=[],trainY=[];
            for(var ti=0;ti<nSamples;ti++){
                if(ti===holdIdx)continue;
                for(var fi=0;fi<d;fi++)trainX.push(Xbuf[ti*d+fi]);
                trainY.push(Ybuf[ti*2],Ybuf[ti*2+1]);
            }
            var W=solveRidge(trainX,trainY,d,nSamples-1,10.0);
            if(!W){overlay.remove();cb(null,d,999);return;}
            var holdFeat=[];for(var hi=0;hi<d;hi++)holdFeat.push(Xbuf[holdIdx*d+hi]);
            var pred=predictXY(holdFeat,W,d);
            var dx=pred[0]-Ybuf[holdIdx*2],dy=pred[1]-Ybuf[holdIdx*2+1];
            var rmse=Math.sqrt(dx*dx+dy*dy);
            if(rmse>150&&retryCount<2){
                overlay.remove();
                runCalibration(nPts,cb,retryCount+1);
                return;
            }
            var Wfull=solveRidge(Xbuf,Ybuf,d,nSamples,10.0);
            overlay.remove();
            cb(Wfull,d,rmse,Xbuf.slice(),Ybuf.slice());
            return;
        }
        var px=pts[pIdx][0],py=pts[pIdx][1];
        var screenX=window.innerWidth*px/100,screenY=window.innerHeight*py/100;
        dot.style.left="calc("+px+"% - 10px)";dot.style.top="calc("+py+"% - 10px)";
        ring.style.left="calc("+px+"% - 18px)";ring.style.top="calc("+py+"% - 18px)";
        progressBar.style.width=Math.round(pIdx/pts.length*100)+"%";
        label.textContent="Look at the dot ("+(pIdx+1)+"/"+pts.length+")";
        var frames=[],fCount=0;
        var capTimer=setInterval(function(){
            if(mpLandmarker&&emoVideo&&emoVideo.readyState>=2){
                try{
                    var res=mpLandmarker.detectForVideo(emoVideo,performance.now());
                    if(res.faceLandmarks&&res.faceLandmarks.length&&res.faceLandmarks[0].length>473){
                        var feat=extractGazeFeat(res.faceLandmarks[0],res.facialTransformationMatrixes);
                        frames.push(feat);
                    }
                }catch(e){}
            }
            fCount++;
            if(fCount>=15){
                clearInterval(capTimer);
                if(frames.length>=5){
                    var avg=new Array(d);for(var i=0;i<d;i++){var s=0;for(var j=0;j<frames.length;j++)s+=frames[j][i];avg[i]=s/frames.length;}
                    avg[d-1]=1;
                    for(var i=0;i<d;i++)Xbuf.push(avg[i]);
                    Ybuf.push(screenX,screenY);
                }
                pIdx++;
                setTimeout(showPoint,400);
            }
        },40);
    }
    setTimeout(showPoint,800);
}

// FACS AU extraction from MediaPipe 478 landmarks
var FACS_IDX={liB:107,riB:336,lmB:105,rmB:334,leI:133,leO:33,leT:159,leB:145,reI:362,reO:263,reT:386,reB:374,mL:61,mR:291,mUT:0,mLB:17,chin:152,nB:2};
function extractAUs(lm){
    if(!lm||lm.length<474)return null;
    var d=function(a,b){return Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y));};
    var rd=d(lm[FACS_IDX.leI],lm[FACS_IDX.reI])||1e-5;
    var clamp=function(v){return Math.max(0,Math.min(1,v));};
    var au1=clamp(((d(lm[FACS_IDX.liB],lm[FACS_IDX.leT])+d(lm[FACS_IDX.riB],lm[FACS_IDX.reT]))/2/rd-0.35)/0.15);
    var au4=clamp((0.75-d(lm[FACS_IDX.lmB],lm[FACS_IDX.rmB])/rd)/0.15);
    var au6=clamp((0.12-(d(lm[FACS_IDX.leT],lm[FACS_IDX.leB])+d(lm[FACS_IDX.reT],lm[FACS_IDX.reB]))/2/rd)/0.06);
    var mw=d(lm[FACS_IDX.mL],lm[FACS_IDX.mR])/rd;
    var au12=clamp((mw-0.50)/0.20);
    var au15=clamp((d(lm[FACS_IDX.mLB],lm[FACS_IDX.chin])/rd-0.55)/0.15);
    var mh=d(lm[FACS_IDX.mUT],lm[FACS_IDX.mLB])/rd;
    var au25=clamp((mh-0.03)/0.08);
    var au26=clamp((d(lm[FACS_IDX.nB],lm[FACS_IDX.chin])/rd-0.90)/0.20);
    return{AU1:au1,AU4:au4,AU6:au6,AU12:au12,AU15:au15,AU25:au25,AU26:au26};
}
function classifyEmo(a){
    var sc={joy:a.AU6*0.6+a.AU12*0.4,sadness:a.AU1*0.2+a.AU4*0.3+a.AU15*0.5,surprise:a.AU1*0.25+a.AU25*0.2+a.AU26*0.3,anger:a.AU4*0.6+a.AU25*0.2,disgust:a.AU15*0.5+a.AU4*0.2,fear:a.AU1*0.2+a.AU4*0.35+a.AU25*0.1,neutral:0};
    var mx=Math.max(a.AU1,a.AU4,a.AU6,a.AU12,a.AU15,a.AU25,a.AU26);
    sc.neutral=mx<0.15?1-mx:0.1;
    var be="neutral",bs=sc.neutral;
    for(var e in sc){if(sc[e]>bs){bs=sc[e];be=e;}}
    return{emotion:be,confidence:Math.min(1,bs)};
}

// Last known cursor position
var lastCursorX=0,lastCursorY=0;
var isMobile="ontouchstart"in window||navigator.maxTouchPoints>0;
document.addEventListener("mousemove",function(e){lastCursorX=e.clientX;lastCursorY=e.clientY;},true);
document.addEventListener("touchmove",function(e){var t=e.touches[0];if(t){lastCursorX=t.clientX;lastCursorY=t.clientY;}},true);

function startEmotionCapture(){
    if(!C.emotions||emoRunning)return;
    navigator.mediaDevices.getUserMedia({video:{width:320,height:240,facingMode:"user"},audio:false})
    .then(function(stream){
        emoStream=stream;
        var v=document.createElement("video");
        v.setAttribute("autoplay","");v.setAttribute("muted","");v.setAttribute("playsinline","");
        v.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
        v.srcObject=stream;
        document.body.appendChild(v);
        emoVideo=v;
        loadMediaPipe(function(){
            emoRunning=true;
            emoStartTime=Date.now();
            emoInterval=setInterval(sampleFrame,500);
            if(C.emoVideo)startEmoRecording(stream);
        });
    })
    .catch(function(e){});
}

function onCalDone(W,d,rmse,xBuf,yBuf){
    gazeWeights=W;gazeFeatDim=d;gazeRmsePx=rmse||999;
    gazeQuality=rmse<=80?"good":rmse<=150?"fair":"low";
    oeState={x:null,dx:null,y:null,dy:null,lastT:0};
    if(xBuf&&yBuf){calXbuf=xBuf;calYbuf=yBuf;}
    tapsSinceRetrain=0;
    if(W)store("_ecx_gaze_cal_"+C.rid,JSON.stringify({w:W,d:d,r:rmse,t:Date.now()}));
    startGazeSampling();
}

function startGazeCapture(){
    if(!C.gaze||!isMobile)return;
    var cached=load("_ecx_gaze_cal_"+C.rid);
    if(cached){
        try{var c=JSON.parse(cached);if(Date.now()-c.t<600000){gazeWeights=c.w;gazeFeatDim=c.d;gazeRmsePx=c.r||999;gazeQuality=c.r<=80?"good":c.r<=150?"fair":"low";startGazeSampling();return;}}catch(e){}
    }
    if(emoVideo&&mpLandmarker){
        runCalibration(C.gazeCal,onCalDone);
        return;
    }
    function initGazeStream(stream){
        if(!emoStream){emoStream=stream;}
        if(!emoVideo){
            var v=document.createElement("video");
            v.setAttribute("autoplay","");v.setAttribute("muted","");v.setAttribute("playsinline","");
            v.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
            v.srcObject=stream;
            document.body.appendChild(v);
            emoVideo=v;
        }
        loadMediaPipe(function(){if(mpLandmarker)runCalibration(C.gazeCal,onCalDone);});
    }
    navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"},audio:false})
    .then(initGazeStream)
    .catch(function(){
        navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:"user"},audio:false})
        .then(initGazeStream)
        .catch(function(){});
    });
}

function startGazeSampling(){
    if(!gazeWeights)return;
    if(!emoRunning){
        emoRunning=true;
        emoStartTime=Date.now();
        emoInterval=setInterval(sampleFrame,500);
    }
}

function loadMediaPipe(cb){
    if(mpLandmarker){cb();return;}
    var base="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32";
    // Dynamic import() works in all modern browsers and handles ES modules correctly
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
    .catch(function(){
        // MediaPipe failed — fall back to face-api.js for emotions only
        loadFaceApiFallback(cb);
    });
}

// Fallback: face-api.js if MediaPipe fails (older browsers)
var useFaceApiFallback=false;
function loadFaceApiFallback(cb){
    useFaceApiFallback=true;
    if(window.faceapi){cb();return;}
    var sc=document.createElement("script");
    sc.src="https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js";
    sc.onload=function(){
        Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(C.emoModelUrl),
            faceapi.nets.faceExpressionNet.loadFromUri(C.emoModelUrl)
        ]).then(cb).catch(function(){});
    };
    sc.onerror=function(){};
    document.head.appendChild(sc);
}

function sampleFrame(){
    if(!emoRunning||paused||!emoVideo||emoVideo.readyState<2)return;
    var elapsed=emoActiveMs+(Date.now()-emoStartTime);
    if(elapsed>EMO_MAX_MS){stopEmotionCapture();return;}
    var ts=Date.now()-emoStartTime;

    if(useFaceApiFallback){
        if(!C.emotions)return;
        // Legacy face-api.js path (no gaze)
        faceapi.detectSingleFace(emoVideo,new faceapi.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:0.4}))
        .withFaceExpressions()
        .then(function(det){
            if(!det||!emoRunning)return;
            var expr=det.expressions;
            var best="neutral",bestScore=0;
            for(var k in expr){if(expr[k]>bestScore){bestScore=expr[k];best=k;}}
            var mapped=EXPRESSION_MAP[best]||"neutral";
            var ex={};for(var e in EXPRESSION_MAP){if(expr[e]!=null)ex[EXPRESSION_MAP[e]]=Math.round(expr[e]*1000)/1000;}
            emoBuf.push({timestamp:ts,emotion:mapped,confidence:Math.round(bestScore*1000)/1000,expressions:ex});
        }).catch(function(){});
        return;
    }

    // MediaPipe path — emotions via FACS + gaze via iris
    if(!mpLandmarker)return;
    try{
        var res=mpLandmarker.detectForVideo(emoVideo,performance.now());
        if(!res.faceLandmarks||!res.faceLandmarks.length)return;
        var lm=res.faceLandmarks[0];

        // Emotion from FACS
        var aus=C.emotions?extractAUs(lm):null;
        if(aus){
            var emo=classifyEmo(aus);
            emoBuf.push({timestamp:ts,emotion:emo.emotion,confidence:Math.round(emo.confidence*1000)/1000});
        }

        // Gaze from iris (468=left iris, 473=right iris)
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
            if(isMobile&&gazeWeights){
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
            if(isMobile&&gazeWeights){sample.gazeQuality=gazeQuality;sample.gazeRmse=Math.round(gazeRmsePx);feedFixation(gpx,gpy,ts);}
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
    // Convert to base64 and POST (best-effort, async)
    var reader=new FileReader();
    reader.onloadend=function(){
        var b64=reader.result.split(",")[1];
        if(!b64||b64.length>20971520)return; // 15MB cap
        var body=JSON.stringify({sessionId:sid,video:b64});
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
