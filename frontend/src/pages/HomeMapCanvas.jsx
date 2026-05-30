/**
 * HomeMapCanvas v5 — AI-rendered SVG background + live device overlay
 *
 * View mode:
 *   • Checks for a cached AI-generated SVG via GET /api/map/render
 *   • If ready → renders SVG as Konva Image (base layer) + device pins on top
 *   • If not generated → shows isometric Konva fallback + "Generate AI Map" button
 *   • While generating → spinner; polls until ready then swaps in the SVG
 *
 * Build mode (viewOnly=false):
 *   • Always shows the isometric Konva fallback (drag/resize experience)
 *   • "Regenerate" button clears the SVG cache for the new layout
 *
 * The SVG uses identical w2s() coordinate math to the fallback renderer,
 * so device pins stay perfectly aligned over rooms in both modes.
 */
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { Stage, Layer, Line, Text, Group, Circle, Image as KonvaImage } from 'react-konva'
import { getMapCanvas, putMapCanvasPosition, getMapRender, triggerMapRender } from '../lib/api'
import { useT } from '../lib/i18n'

// ─── Projection (mirrors map_renderer.py + HomeMapCanvas constants) ───────
const ISO_X   = 30
const ISO_Y   = 15
const WALL_PX = 28
const SNAP_M  = 0.4
const MIN_M   = 1.5
const API_S   = 50

function w2s(mx, my, mz = 0) {
  return { x: (mx - my) * ISO_X, y: (mx + my) * ISO_Y - mz * WALL_PX }
}
function screenDeltaToWorld(sdx, sdy) {
  return { x: (sdx / ISO_X + sdy / ISO_Y) / 2, y: (sdy / ISO_Y - sdx / ISO_X) / 2 }
}

// ─── Room defaults ─────────────────────────────────────────────────────────
const TYPE_SIZES = {
  living:[6,4], salon:[6,4], lounge:[6,4],
  bedroom:[4,3], master:[5,4], kitchen:[3,3],
  bathroom:[2.5,2], toilet:[1.5,1.5],
  office:[3.5,3], study:[3.5,3],
  corridor:[4,1.5], hallway:[4,1.5],
  garage:[5,5], balcony:[3,1.5], garden:[5,4], stairs:[3,1.5],
}
function defaultSize(name) {
  const n = (name || '').toLowerCase()
  for (const [k,[w,h]] of Object.entries(TYPE_SIZES)) if (n.includes(k)) return {w,h}
  return {w:3,h:3}
}

// ─── Colours (fallback renderer) ───────────────────────────────────────────
const PAL = {
  bedroom:['#bfd8f5','#8eb4e0','#5e8fc8'], master:['#f2c8e0','#d89ac0','#be6c9e'],
  living:['#b8f0cc','#80d4a0','#50b478'],  salon:['#b8f0cc','#80d4a0','#50b478'],
  lounge:['#b8f0cc','#80d4a0','#50b478'],  kitchen:['#f8f4b0','#e0d878','#c8bc48'],
  bathroom:['#a8ecf8','#70cce0','#48acc0'], toilet:['#c8f4f8','#90d8e8','#60b8c8'],
  office:['#d8ccf8','#b0a8e0','#8880c8'],   corridor:['#f8d8ec','#e0b0d0','#c888b0'],
  hallway:['#f8d8ec','#e0b0d0','#c888b0'],  stairs:['#fce8c8','#e4c498','#ccaa68'],
  garage:['#dce8f0','#b4c8d8','#8ca8c0'],   balcony:['#c8f8e0','#90e0b8','#58c888'],
  garden:['#c8f8e0','#90e0b8','#58c888'],   default:['#e8ecf2','#c4c8d0','#a0a8b4'],
}
const PAL_DARK = {
  bedroom:['#1e3a5c','#2a4e78','#163060'], master:['#4a1a38','#682850','#861868'],
  living:['#0e3820','#145030','#186840'],   salon:['#0e3820','#145030','#186840'],
  lounge:['#0e3820','#145030','#186840'],   kitchen:['#383000','#504400','#685800'],
  bathroom:['#0c2838','#104050','#145870'], toilet:['#0c2838','#104050','#145870'],
  office:['#1e1058','#2c1880','#3a22a8'],   corridor:['#380828','#501040','#681858'],
  hallway:['#380828','#501040','#681858'],  stairs:['#381800','#502800','#683800'],
  garage:['#182030','#202c40','#2c3850'],   balcony:['#0a2818','#103820','#164830'],
  garden:['#0a2818','#103820','#164830'],   default:['#1e2230','#282e40','#323c50'],
}
function roomPal(name) {
  const n = (name||'').toLowerCase()
  const dark = document.documentElement.classList.contains('dark')
  const src = dark ? PAL_DARK : PAL
  for (const [k,c] of Object.entries(src)) if (n.includes(k)) return c
  return src.default
}

// ─── Device icons ──────────────────────────────────────────────────────────
const DICONS = {
  light:'💡', switch:'🔌', climate:'❄️', media_player:'📺',
  cover:'🪟', fan:'💨', lock:'🔒', sensor:'🌡️',
  binary_sensor:'🔔', vacuum:'🤖', camera:'📷',
}
const entityIcon = eid => DICONS[(eid||'').split('.')[0]] || '⚡'

// ─── Snap (world metres) ───────────────────────────────────────────────────
function snapWorld(id, pos, all) {
  let sx=pos.x, sy=pos.y
  const r=pos.x+pos.w, b=pos.y+pos.h
  let mdx=SNAP_M+.01, mdy=SNAP_M+.01
  for (const [pid,p] of Object.entries(all)) {
    if (pid===id) continue
    const pr=p.x+p.w, pb=p.y+p.h
    for (const [me,th] of [[pos.x,p.x],[pos.x,pr],[r,p.x],[r,pr]]) {
      const dx=Math.abs(me-th); if (dx<mdx){mdx=dx; sx=th-(me-pos.x)}
    }
    for (const [me,th] of [[pos.y,p.y],[pos.y,pb],[b,p.y],[b,pb]]) {
      const dy=Math.abs(me-th); if (dy<mdy){mdy=dy; sy=th-(me-pos.y)}
    }
  }
  return {x:sx, y:sy}
}

// ─── Default layout ────────────────────────────────────────────────────────
function buildLayout(rooms) {
  const COLS=3; const out={}
  let rowY=0, rowMaxH=0
  rooms.forEach((room,i) => {
    const col=i%COLS
    const {w,h}=defaultSize(room.name)
    if (col===0 && i>0) { rowY+=rowMaxH; rowMaxH=0 }
    let rowX=0
    const rs=Math.floor(i/COLS)*COLS
    for (let j=rs;j<i;j++) rowX+=defaultSize(rooms[j]?.name).w
    out[room.id]={x:rowX, y:rowY, w, h}
    rowMaxH=Math.max(rowMaxH,h)
  })
  return out
}

function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

// ─── Auto-fit ──────────────────────────────────────────────────────────────
function autoFitViewBox(stageRef, vb, sw, sh) {
  if (!stageRef.current || !vb) return
  const PAD=16
  const sc=Math.min((sw-PAD*2)/vb.w, (sh-PAD*2)/vb.h, 3)
  stageRef.current.scale({x:sc,y:sc})
  stageRef.current.position({x:(-vb.x+PAD)*sc, y:(-vb.y+PAD)*sc})
}
function autoFitPositions(stageRef, positions, sw, sh) {
  if (!stageRef.current || !Object.keys(positions).length) return
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
  for (const p of Object.values(positions)) {
    const pts=[w2s(p.x,p.y,1),w2s(p.x+p.w,p.y,1),w2s(p.x,p.y+p.h,1),w2s(p.x+p.w,p.y+p.h,1),
               w2s(p.x,p.y+p.h,0),w2s(p.x+p.w,p.y+p.h,0),w2s(p.x+p.w,p.y,0)]
    pts.forEach(({x,y})=>{minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)})
  }
  const PAD=24
  const sc=Math.min((sw-PAD*2)/(maxX-minX),(sh-PAD*2)/(maxY-minY),2.5)
  stageRef.current.scale({x:sc,y:sc})
  stageRef.current.position({x:(-minX+PAD)*sc,y:(-minY+PAD)*sc})
}

// ─── Isometric room geometry (fallback only — no device pins) ─────────────
function IsoRoomFallback({ room, pos, selected, locked, viewOnly, groupRef, onSelect, onDragEnd, t }) {
  const [topC,southC,eastC]=roomPal(room.name)
  const dark=document.documentElement.classList.contains('dark')
  const {x:mx,y:my,w:mw,h:mh}=pos

  const tTL=w2s(mx,   my,   1), tTR=w2s(mx+mw,my,   1)
  const tBL=w2s(mx,   my+mh,1), tBR=w2s(mx+mw,my+mh,1)
  const bBL=w2s(mx,   my+mh,0), bBR=w2s(mx+mw,my+mh,0)
  const bTR=w2s(mx+mw,my,   0)

  const selC=selected&&!viewOnly?'#6d28d9':null
  const edgeTop =selC||(dark?'rgba(255,255,255,0.18)':'rgba(255,255,255,0.7)')
  const edgeWall=selC||(dark?'rgba(0,0,0,0.35)':'rgba(0,0,0,0.12)')
  const sw=selected&&!viewOnly?2:1
  const cx=(tTL.x+tTR.x+tBR.x+tBL.x)/4, cy=(tTL.y+tTR.y+tBR.y+tBL.y)/4

  const presColor=room.presence==='occupied'?(dark?'#145028':'#bbf7d0')
                 :room.presence==='uncertain'?(dark?'#3d1a00':'#fef3c7'):null

  const click=useCallback((e)=>{e.cancelBubble=true;if(!viewOnly)onSelect()},[onSelect,viewOnly])

  return (
    <Group ref={groupRef} x={0} y={0}
      draggable={!locked&&!viewOnly} onDragEnd={onDragEnd}
      onClick={click} onTap={click}
    >
      <Line points={[tTR.x,tTR.y,tBR.x,tBR.y,bBR.x,bBR.y,bTR.x,bTR.y]}
        closed fill={eastC}  stroke={edgeWall} strokeWidth={sw} listening={false}/>
      <Line points={[tBL.x,tBL.y,tBR.x,tBR.y,bBR.x,bBR.y,bBL.x,bBL.y]}
        closed fill={southC} stroke={edgeWall} strokeWidth={sw} listening={false}/>
      <Line points={[tTL.x,tTL.y,tTR.x,tTR.y,tBR.x,tBR.y,tBL.x,tBL.y]}
        closed fill={presColor||topC} stroke={edgeTop} strokeWidth={sw}/>
      <Text x={cx-50} y={cy-10} width={100} text={room.name}
        fontSize={Math.max(9,Math.min(13,(mw+mh)*2.2))} fontStyle="bold"
        fill={dark?'rgba(255,255,255,0.88)':'rgba(0,0,0,0.68)'} align="center" wrap="none" ellipsis/>
      <Text x={cx-40} y={cy+5} width={80}
        text={room.summary||(room.active_count>0?(t?t('homeMap.onSuffix',{n:room.active_count}):`${room.active_count} on`):'')}
        fontSize={8} fill={dark?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.4)'} align="center" wrap="none" ellipsis/>
      {room.anomalies?.[0]&&(
        <Circle x={tTR.x-8} y={tTR.y+6} radius={5}
          fill={room.anomalies[0].severity==='critical'?'#ef4444':'#f97316'}
          stroke="white" strokeWidth={1.5}/>
      )}
    </Group>
  )
}

// ─── Device pins (always on top — same in both SVG and fallback modes) ─────
function RoomDevicePins({ room, pos }) {
  const devices=(room.devices||[]).slice(0,6)
  const {x:mx,y:my,w:mw,h:mh}=pos
  return (
    <>
      {devices.map((dev,di)=>{
        const cols=Math.min(3,devices.length)
        const row=Math.floor(di/cols), col=di%cols
        const pinMx=mx+0.5+(col+0.5)*((mw-0.5)/Math.max(cols,1))
        const pinMy=my+0.4+(row+0.3)*Math.min(mh*0.45,1.4)
        const ps=w2s(pinMx,pinMy,1)
        const isOn=dev.state==='on'
        return (
          <Group key={dev.entity_id} x={ps.x} y={ps.y-18}>
            <Circle radius={13} fill="white"
              shadowColor="rgba(0,0,0,0.28)" shadowBlur={5} shadowOffsetY={2}/>
            <Text text={entityIcon(dev.entity_id)} fontSize={13} x={-6.5} y={-6.5}/>
            {isOn&&<Circle x={9} y={-9} radius={3.5} fill="#22c55e" stroke="white" strokeWidth={1}/>}
          </Group>
        )
      })}
    </>
  )
}

// ─── Measurement panel ─────────────────────────────────────────────────────
function MeasurementPanel({room,pos,onResize,onClose}) {
  const t = useT()
  const [w,setW]=useState(String(pos.w)), [h,setH]=useState(String(pos.h))
  useEffect(()=>{setW(String(pos.w))},[pos.w])
  useEffect(()=>{setH(String(pos.h))},[pos.h])
  const chW=v=>{setW(v);const n=parseFloat(v);if(!isNaN(n)&&n>=MIN_M)onResize(n,pos.h)}
  const chH=v=>{setH(v);const n=parseFloat(v);if(!isNaN(n)&&n>=MIN_M)onResize(pos.w,n)}
  const inp="w-16 px-2 py-1 rounded-lg border border-line bg-surface text-sm text-center text-ink"
  return (
    <div className="p-3 rounded-xl border border-accent-soft bg-accent-soft">
      <div className="flex items-center justify-between mb-2">
        <p dir="auto" className="text-xs font-semibold text-accent">{room.name}</p>
        <button onClick={onClose} aria-label={t('common.close')} className="text-xs text-ink-mute hover:text-ink-2">✕</button>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-ink-mute">
          {t('homeMap.widthLabel')} <input type="number" min={MIN_M} step={0.5} value={w} onChange={e=>chW(e.target.value)} className={inp}/> {t('homeMap.metersUnit')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-mute">
          {t('homeMap.heightLabel')} <input type="number" min={MIN_M} step={0.5} value={h} onChange={e=>chH(e.target.value)} className={inp}/> {t('homeMap.metersUnit')}
        </label>
      </div>
    </div>
  )
}

// ─── Main canvas ───────────────────────────────────────────────────────────
export function HomeMapCanvas({ rooms, viewOnly=false }) {
  const t = useT()
  const containerRef=useRef(null), stageRef=useRef(null)
  const groupRefs=useRef({}), lastPinch=useRef(0)

  const saveRef=useRef(debounce(async(id,pos)=>{
    try{await putMapCanvasPosition(id,{x:pos.x*API_S,y:pos.y*API_S,width:pos.w*API_S,height:pos.h*API_S})}
    catch{}
  },600))

  const [stageW,setStageW]   =useState(300)
  const [positions,setPositions]=useState({})
  const [selectedId,setSelectedId]=useState(null)
  const [loading,setLoading] =useState(true)
  const [locked,setLocked]   =useState(false)
  const [zoom,setZoom]       =useState(1)

  // AI render state
  const [renderStatus,setRenderStatus]=useState('idle') // idle|checking|ready|generating|failed
  const [svgData,setSvgData] =useState(null)
  const [svgViewBox,setSvgViewBox]=useState(null)
  const [bgImage,setBgImage] =useState(null)
  const pollRef=useRef(null)

  const stageH=viewOnly
    ? Math.max(460,(typeof window!=='undefined'?window.innerHeight:700)-180)
    : Math.max(400,(typeof window!=='undefined'?window.innerHeight:700)-270)

  useLayoutEffect(()=>{
    const el=containerRef.current; if(!el) return
    const resize=()=>setStageW(el.offsetWidth||300)
    resize(); const ro=new ResizeObserver(resize); ro.observe(el)
    return()=>ro.disconnect()
  },[])

  // Load canvas positions
  useEffect(()=>{
    getMapCanvas()
      .then(({positions:saved})=>{
        if(saved?.length){
          const hasOld=saved.some(p=>p.x/API_S>50||p.y/API_S>50)
          if(!hasOld){
            const map={}
            saved.forEach(p=>{map[p.room_id]={x:p.x/API_S,y:p.y/API_S,w:Math.max(MIN_M,p.width/API_S),h:Math.max(MIN_M,p.height/API_S)}})
            setPositions(map)
          } else { setPositions(buildLayout(rooms)) }
        } else { setPositions(buildLayout(rooms)) }
      })
      .catch(()=>setPositions(buildLayout(rooms)))
      .finally(()=>setLoading(false))
  },[])

  // Add defaults for new rooms
  useEffect(()=>{
    if(loading) return
    setPositions(prev=>{
      const next={...prev}; let changed=false
      rooms.forEach(room=>{
        if(!next[room.id]){
          const keys=Object.keys(next)
          const last=keys.length?next[keys[keys.length-1]]:{x:0,y:0,w:3,h:3}
          const {w,h}=defaultSize(room.name)
          next[room.id]={x:last.x+last.w,y:last.y,w,h}; changed=true
        }
      })
      return changed?next:prev
    })
  },[rooms,loading])

  // On first load, check if an AI render already exists
  useEffect(()=>{
    if(loading||!Object.keys(positions).length) return
    setRenderStatus('checking')
    getMapRender()
      .then(data=>{
        if(data.status==='ready'){
          setSvgData(data.svg); setSvgViewBox(data.viewbox); setRenderStatus('ready')
        } else {
          setRenderStatus('idle')
        }
      })
      .catch(()=>setRenderStatus('idle'))
  },[loading])

  // Load SVG into HTMLImageElement for Konva
  useEffect(()=>{
    if(!svgData) return
    const img=new window.Image()
    img.onload=()=>{
      setBgImage(img)
      if(svgViewBox) setTimeout(()=>autoFitViewBox(stageRef,svgViewBox,stageW,stageH),120)
    }
    img.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`
  },[svgData])

  // Auto-fit fallback positions
  useEffect(()=>{
    if(loading||!Object.keys(positions).length||stageW<100||renderStatus==='ready') return
    const t=setTimeout(()=>autoFitPositions(stageRef,positions,stageW,stageH),160)
    return()=>clearTimeout(t)
  },[loading,stageW,stageH,renderStatus])

  // Poll while generating
  useEffect(()=>{
    if(renderStatus!=='generating') return
    pollRef.current=setInterval(()=>{
      getMapRender().then(data=>{
        if(data.status==='ready'){
          setSvgData(data.svg); setSvgViewBox(data.viewbox)
          setRenderStatus('ready')
          clearInterval(pollRef.current)
        }
      }).catch(()=>{})
    },3000)
    return()=>clearInterval(pollRef.current)
  },[renderStatus])

  const handleGenerate=useCallback(async()=>{
    if(renderStatus==='generating') return
    setRenderStatus('generating')
    setBgImage(null); setSvgData(null)
    try{
      await triggerMapRender(rooms.map(r=>({id:r.id,name:r.name})))
    }catch{
      setRenderStatus('failed')
    }
  },[rooms,renderStatus])

  // Drag handling
  const handleDragEnd=useCallback((id,e)=>{
    const g=e.target
    const delta=screenDeltaToWorld(g.x(),g.y())
    const old=positions[id]; if(!old) return
    const moved={...old,x:old.x+delta.x,y:old.y+delta.y}
    const snapped=snapWorld(id,moved,positions)
    const final={...moved,...snapped}
    setPositions(p=>({...p,[id]:final}))
    saveRef.current(id,final)
  },[positions])

  const handleResize=useCallback((id,w,h)=>{
    setPositions(p=>{const pos={...p[id],w,h};saveRef.current(id,pos);return{...p,[id]:pos}})
  },[])

  const handleWheel=useCallback((e)=>{
    e.evt.preventDefault()
    const stage=stageRef.current; if(!stage) return
    const old=stage.scaleX(), ptr=stage.getPointerPosition()
    const origin={x:(ptr.x-stage.x())/old,y:(ptr.y-stage.y())/old}
    const ns=Math.min(6,Math.max(0.1,old*(e.evt.deltaY<0?1.1:0.9)))
    stage.scale({x:ns,y:ns}); stage.position({x:ptr.x-origin.x*ns,y:ptr.y-origin.y*ns}); setZoom(ns)
  },[])

  const handleTouchMove=useCallback((e)=>{
    const t=e.evt.touches; if(t.length!==2) return
    const d=Math.hypot(t[1].clientX-t[0].clientX,t[1].clientY-t[0].clientY)
    if(lastPinch.current>0){
      const ns=Math.min(6,Math.max(0.1,stageRef.current.scaleX()*(d/lastPinch.current)))
      stageRef.current.scale({x:ns,y:ns}); setZoom(ns)
    }
    lastPinch.current=d
  },[])

  const resetLayout=()=>{
    const lay=buildLayout(rooms); setPositions(lay)
    stageRef.current?.position({x:0,y:0}); stageRef.current?.scale({x:1,y:1}); setZoom(1)
    setTimeout(()=>autoFitPositions(stageRef,lay,stageW,stageH),60)
    Object.entries(lay).forEach(([id,pos])=>saveRef.current(id,pos))
  }

  const selRoom=rooms.find(r=>r.id===selectedId)
  const selPos=selectedId?positions[selectedId]:null
  const dark=document.documentElement.classList.contains('dark')
  const bgColor=dark?'#0e1015':'#e8edf4'
  const showSvg=renderStatus==='ready'&&!!bgImage

  // Painter's sort
  const sorted=[...rooms].sort((a,b)=>{
    const pa=positions[a.id],pb=positions[b.id]; if(!pa||!pb) return 0
    return (pa.x+pa.y)-(pb.x+pb.y)
  })

  if(loading) return <div className="flex items-center justify-center h-48 text-ink-mute text-sm">{t('homeMap.loadingFloorPlan')}</div>

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {!viewOnly && (
          <button
            onClick={()=>{setLocked(l=>!l);setSelectedId(null)}}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              locked?'bg-ink text-bg'
                    :'bg-surface-2 text-ink-2'}`}
          >
            {locked?t('homeMap.locked'):t('homeMap.editing')}
          </button>
        )}
        {!viewOnly && (
          <p className="text-xs text-ink-mute flex-1">
            {locked?t('homeMap.tapEditingHint'):t('homeMap.dragRoomsHint')}
          </p>
        )}
        {viewOnly && <div className="flex-1"/>}

        {/* AI render button — hidden until feature is ready */}

        {!viewOnly && (
          <>
            <span className="text-[10px] text-ink-mute">{Math.round(zoom*100)}%</span>
            <button onClick={resetLayout} className="text-xs text-accent underline">{t('homeMap.reset')}</button>
          </>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef}
        className="w-full rounded-2xl overflow-hidden border border-line"
        style={{height:stageH, background:bgColor}}
      >
        <Stage ref={stageRef} width={stageW} height={stageH} draggable
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchEnd={()=>{lastPinch.current=0}}
          onClick={e=>{if(e.target===e.target.getStage())setSelectedId(null)}}
          onTap={e=>{if(e.target===e.target.getStage())setSelectedId(null)}}
        >
          {/* Base layer: AI SVG image OR isometric fallback polygons */}
          <Layer>
            {showSvg ? (
              <KonvaImage
                image={bgImage}
                x={svgViewBox.x} y={svgViewBox.y}
                width={svgViewBox.w} height={svgViewBox.h}
                listening={false}
              />
            ) : (
              sorted.map(room=>{
                const pos=positions[room.id]; if(!pos) return null
                return (
                  <IsoRoomFallback key={room.id}
                    room={room} pos={pos}
                    selected={selectedId===room.id}
                    locked={locked} viewOnly={viewOnly}
                    groupRef={el=>{if(el)groupRefs.current[room.id]=el}}
                    onSelect={()=>setSelectedId(selectedId===room.id?null:room.id)}
                    onDragEnd={e=>handleDragEnd(room.id,e)}
                    t={t}
                  />
                )
              })
            )}
          </Layer>

          {/* Device pin layer — always on top, same coordinate system */}
          <Layer listening={false}>
            {sorted.map(room=>{
              const pos=positions[room.id]; if(!pos) return null
              return <RoomDevicePins key={room.id} room={room} pos={pos}/>
            })}
          </Layer>
        </Stage>
      </div>

      {/* Measurement panel — build mode only */}
      {!viewOnly&&selRoom&&selPos&&!locked&&(
        <MeasurementPanel room={selRoom} pos={selPos}
          onResize={(w,h)=>handleResize(selectedId,w,h)}
          onClose={()=>setSelectedId(null)}
        />
      )}
    </div>
  )
}
