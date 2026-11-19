// 品牌场景图（Task 13a / brief Step 1、spec §9「StorageScene 动画场景移植为 React 组件 GopherScene」）。
// 逐坐标移植旧 Vue `StorageScene.vue`（历史 adbcfba）：SVG 几何/色彩原样搬运（素材内禀色豁免规范 §4，
// asset-credits 登记）；rAF 沿 flight path 飞包（周期 5300ms：750ms 起飞延迟、2850ms 巡航、
// 650/3900 两端透明度淡入淡出——旧 draw() 公式原样）；prefers-reduced-motion 降级=旧 syncMotion()
// 语义逐字镜像：matchMedia 变化即「静态包位置 (350,154)/旋转 0/不透明 1，停 rAF」↔「恢复飞行动画」。
// 无障碍（旧同）：svg aria-hidden + focusable=false（装饰性场景），figcaption 承载唯一可读文本。
// 接入点：登录卡 footer 带（mascot PNG 保留在 header，R(T13a-22)）、files/trash 空态（Empty children）、
// DropOverlay 角落（showCaption=false）。
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/components/glinui/lib/cn'

interface Packet {
  x: number
  y: number
  rotation: number
  opacity: number
}

/** 旧 packet 初值（飞行动画 750ms 前不可见）。 */
const PACKET_INITIAL: Packet = { x: 270, y: 175, rotation: 0, opacity: 0 }
/** 旧 syncMotion() 降级帧：停在货架入口，完全可见。 */
const PACKET_STATIC: Packet = { x: 350, y: 154, rotation: 0, opacity: 1 }

export interface GopherSceneProps {
  className?: string
  /** 旧 figcaption「文件从浏览器出发…」；密集场景（如拖放遮罩角落）可关。默认显示。 */
  showCaption?: boolean
}

export function GopherScene({ className, showCaption = true }: GopherSceneProps) {
  const flightPathRef = useRef<SVGPathElement | null>(null)
  const [packet, setPacket] = useState<Packet>(PACKET_INITIAL)

  useEffect(() => {
    let frame = 0
    let startedAt = 0

    // 旧 draw()：逐帧取路径点+前探 1px 求航向角；opacity 双端包络 Math.min(1, 入, 出)。
    const draw = (now: number): void => {
      const path = flightPathRef.current
      // jsdom 无 SVGGeometry 接口（getTotalLength 未实现）：与旧「path 缺席」同形直接停环，不再续帧；
      // 真浏览器 path 恒在场、方法恒存在——行为与旧 draw 逐字一致。
      if (!path || typeof path.getTotalLength !== 'function') return
      if (!startedAt) startedAt = now
      const phase = (now - startedAt) % 5300
      const progress = Math.min(1, Math.max(0, (phase - 750) / 2850))
      const length = path.getTotalLength()
      const point = path.getPointAtLength(progress * length)
      const next = path.getPointAtLength(Math.min(length, progress * length + 1))
      setPacket({
        x: point.x,
        y: point.y,
        rotation: (Math.atan2(next.y - point.y, next.x - point.x) * 180) / Math.PI,
        opacity: Math.min(1, (phase - 650) / 300, (3900 - phase) / 350),
      })
      frame = requestAnimationFrame(draw)
    }

    // 旧 syncMotion()：换偏好=立即停帧/重开帧；降级帧为静态 packet（无 rAF）。
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMotion = (): void => {
      cancelAnimationFrame(frame)
      startedAt = 0
      if (motionPreference.matches) {
        setPacket(PACKET_STATIC)
      } else {
        frame = requestAnimationFrame(draw)
      }
    }
    motionPreference.addEventListener('change', syncMotion)
    syncMotion()
    return () => {
      cancelAnimationFrame(frame)
      motionPreference.removeEventListener('change', syncMotion)
    }
  }, [])

  return (
    <figure data-testid="gopher-scene" className={cn('m-0 w-full max-w-[620px]', className)}>
      <svg viewBox="0 0 620 360" aria-hidden="true" focusable="false" className="block h-auto w-full">
        <defs>
          <linearGradient id="scene-surface" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#edf7f9" />
            <stop offset="1" stopColor="#e0edf7" />
          </linearGradient>
        </defs>
        <rect x="12" y="18" width="596" height="324" rx="30" fill="url(#scene-surface)" />
        <path d="M46 277h523" stroke="#c4d9e6" strokeWidth="2" />
        <circle cx="541" cy="76" r="34" fill="#f7fbfc" opacity=".75" />
        <circle cx="86" cy="73" r="7" fill="#c8dfea" />
        <circle cx="112" cy="73" r="7" fill="#c8dfea" />
        <circle cx="138" cy="73" r="7" fill="#c8dfea" />

        <image href="/images/go-mouse-pixel-v2.png" x="38" y="100" width="272" height="185" preserveAspectRatio="xMidYMid meet" />
        <text x="60" y="309" fill="#68828c" fontSize="14" fontWeight="600">我的文件</text>

        <path
          ref={flightPathRef}
          d="M256 167 C316 101 371 114 424 163"
          fill="none"
          stroke="#93bdcf"
          strokeWidth="2"
          strokeDasharray="5 9"
          strokeLinecap="round"
        />
        <g
          data-testid="gopher-packet"
          transform={`translate(${packet.x} ${packet.y}) rotate(${packet.rotation})`}
          opacity={Math.max(0, packet.opacity)}
        >
          <rect x="-13" y="-16" width="26" height="32" rx="4" fill="#fff" stroke="#3f8fa8" strokeWidth="2" />
          <path d="M-7 -7h13M-7 -1h13M-7 5h8" stroke="#77a9bb" strokeWidth="2" strokeLinecap="round" />
        </g>

        <rect x="422" y="105" width="146" height="179" rx="18" fill="#fff" stroke="#bfd5e3" strokeWidth="2" />
        <rect x="439" y="123" width="112" height="42" rx="9" fill="#e9f4f7" />
        <rect x="439" y="176" width="112" height="42" rx="9" fill="#e9f4f7" />
        <rect x="439" y="229" width="112" height="38" rx="9" fill="#e9f4f7" />
        <path d="M457 142h51M457 195h51M457 246h51" stroke="#81aabc" strokeWidth="5" strokeLinecap="round" />
        <circle cx="531" cy="144" r="4" fill="#5fa9b8" />
        <circle cx="531" cy="197" r="4" fill="#5fa9b8" />
        <circle cx="531" cy="248" r="4" fill="#5fa9b8" />
        <text x="459" y="309" fill="#68828c" fontSize="14" fontWeight="600">私人云仓</text>
      </svg>
      {showCaption ? (
        <figcaption className="ml-[10px] mt-[9px] text-[11px] text-[var(--color-foreground)] opacity-60">
          文件从浏览器出发，安稳落在你的存储空间。
        </figcaption>
      ) : null}
    </figure>
  )
}
