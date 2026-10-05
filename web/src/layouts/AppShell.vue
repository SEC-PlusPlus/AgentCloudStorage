<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { auth } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const sectionName = computed(() => route.name === 'trash' ? '回收站' : route.query.q ? '搜索' : '我的文件')
function logout() {
  auth.clear()
  void router.replace({ name: 'login' })
}
</script>

<template>
  <main class="app-shell">
    <aside class="app-sidebar">
      <a class="sidebar-brand" href="/" aria-label="AgentCloudStorage 首页"><BrandMark /><span><b>AgentCloud</b><small>PERSONAL CLOUD</small></span></a>
      <div class="workspace-label">工作空间</div>
      <nav class="side-nav" aria-label="主导航">
        <RouterLink class="nav-item" :class="{ selected: route.name === 'home' || route.name === 'search' }" :to="{ name: 'home' }"><span class="nav-icon">▦</span> 我的文件 <span v-if="route.name === 'home' || route.name === 'search'" class="nav-trailing">›</span></RouterLink>
        <RouterLink class="nav-item" :class="{ selected: route.name === 'trash' }" :to="{ name: 'trash' }"><span class="nav-icon">⌑</span> 回收站 <span v-if="route.name === 'trash'" class="nav-trailing">›</span></RouterLink>
      </nav>
      <div class="sidebar-bottom"><div class="storage-glyph">✳</div><p>你的云仓<br /><span>正在准备就绪</span></p><div class="pixel-row">▰ ▱ ▰ ▰ ▱ ▰</div></div>
      <div class="sidebar-version">ACS <span>·</span> PERSONAL EDITION</div>
    </aside>
    <section class="shell-main">
      <header class="shell-header"><div class="breadcrumb"><span>云仓</span><i>/</i><b>{{ sectionName }}</b></div><div class="user-area"><span class="online-indicator" /> <span class="user-email">{{ auth.user.value?.email }}</span><button class="logout-button" type="button" @click="logout">退出登录</button></div></header>
      <RouterView />
    </section>
  </main>
</template>
