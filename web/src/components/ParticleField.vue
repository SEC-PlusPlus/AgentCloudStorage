<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const canvas = ref<HTMLCanvasElement | null>(null)
let frame = 0
let observer: ResizeObserver | undefined
let context: CanvasRenderingContext2D | null = null
const points = Array.from({ length: 44 }, (_, i) => ({
  x: ((i * 79 + 13) % 997) / 997,
  y: ((i * 137 + 31) % 991) / 991,
  size: 0.7 + (i % 3) * 0.45,
  phase: i * 1.31,
}))

function draw(time = 0, animate = true) {
  const el = canvas.value
  if (!el || !context) return
  const { width, height } = el.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
  const pixelWidth = Math.round(width * ratio)
  const pixelHeight = Math.round(height * ratio)
  if (el.width !== pixelWidth || el.height !== pixelHeight) {
    el.width = pixelWidth
    el.height = pixelHeight
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  points.forEach((point) => {
    const alpha = 0.22 + (Math.sin(time / 1500 + point.phase) + 1) * 0.2
    context!.fillStyle = `rgba(111, 205, 255, ${alpha})`
    context!.beginPath()
    context!.arc(point.x * width, point.y * height, point.size, 0, Math.PI * 2)
    context!.fill()
  })
  if (animate) frame = requestAnimationFrame(draw)
}

onMounted(() => {
  const el = canvas.value
  if (!el) return
  context = el.getContext('2d')
  if (!context) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(0, false)
    return
  }
  observer = new ResizeObserver(() => draw())
  observer.observe(el)
  frame = requestAnimationFrame(draw)
})

onUnmounted(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
})
</script>

<template><canvas ref="canvas" class="particle-field" aria-hidden="true" /></template>
