<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const flightPath = ref<SVGPathElement | null>(null)
const packet = ref({ x: 270, y: 175, rotation: 0, opacity: 0 })
let frame = 0
let startedAt = 0
let motionPreference: MediaQueryList | null = null

function draw(now: number) {
  const path = flightPath.value
  if (!path) return
  if (!startedAt) startedAt = now
  const phase = (now - startedAt) % 5300
  const progress = Math.min(1, Math.max(0, (phase - 750) / 2850))
  const length = path.getTotalLength()
  const point = path.getPointAtLength(progress * length)
  const next = path.getPointAtLength(Math.min(length, progress * length + 1))
  packet.value = {
    x: point.x,
    y: point.y,
    rotation: Math.atan2(next.y - point.y, next.x - point.x) * 180 / Math.PI,
    opacity: Math.min(1, (phase - 650) / 300, (3900 - phase) / 350),
  }
  frame = requestAnimationFrame(draw)
}

function syncMotion() {
  cancelAnimationFrame(frame)
  startedAt = 0
  if (motionPreference?.matches) {
    packet.value = { x: 350, y: 154, rotation: 0, opacity: 1 }
  } else {
    frame = requestAnimationFrame(draw)
  }
}

onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionPreference.addEventListener('change', syncMotion)
  syncMotion()
})

onUnmounted(() => {
  cancelAnimationFrame(frame)
  motionPreference?.removeEventListener('change', syncMotion)
})
</script>

<template>
  <figure class="storage-scene">
    <svg viewBox="0 0 620 360" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="scene-surface" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#edf7f9" />
          <stop offset="1" stop-color="#e0edf7" />
        </linearGradient>
      </defs>
      <rect x="12" y="18" width="596" height="324" rx="30" fill="url(#scene-surface)" />
      <path d="M46 277h523" stroke="#c4d9e6" stroke-width="2" />
      <circle cx="541" cy="76" r="34" fill="#f7fbfc" opacity=".75" />
      <circle cx="86" cy="73" r="7" fill="#c8dfea" />
      <circle cx="112" cy="73" r="7" fill="#c8dfea" />
      <circle cx="138" cy="73" r="7" fill="#c8dfea" />

      <image href="/images/go-mouse-pixel-v2.png" x="38" y="100" width="272" height="185" preserveAspectRatio="xMidYMid meet" />
      <text x="60" y="309" class="scene-caption">我的文件</text>

      <path ref="flightPath" d="M256 167 C316 101 371 114 424 163" fill="none" stroke="#93bdcf" stroke-width="2" stroke-dasharray="5 9" stroke-linecap="round" />
      <g :transform="`translate(${packet.x} ${packet.y}) rotate(${packet.rotation})`" :opacity="Math.max(0, packet.opacity)">
        <rect x="-13" y="-16" width="26" height="32" rx="4" fill="#fff" stroke="#3f8fa8" stroke-width="2" />
        <path d="M-7 -7h13M-7 -1h13M-7 5h8" stroke="#77a9bb" stroke-width="2" stroke-linecap="round" />
      </g>

      <rect x="422" y="105" width="146" height="179" rx="18" fill="#fff" stroke="#bfd5e3" stroke-width="2" />
      <rect x="439" y="123" width="112" height="42" rx="9" fill="#e9f4f7" />
      <rect x="439" y="176" width="112" height="42" rx="9" fill="#e9f4f7" />
      <rect x="439" y="229" width="112" height="38" rx="9" fill="#e9f4f7" />
      <path d="M457 142h51M457 195h51M457 246h51" stroke="#81aabc" stroke-width="5" stroke-linecap="round" />
      <circle cx="531" cy="144" r="4" fill="#5fa9b8" />
      <circle cx="531" cy="197" r="4" fill="#5fa9b8" />
      <circle cx="531" cy="248" r="4" fill="#5fa9b8" />
      <text x="459" y="309" class="scene-caption">私人云仓</text>
    </svg>
    <figcaption>文件从浏览器出发，安稳落在你的存储空间。</figcaption>
  </figure>
</template>
