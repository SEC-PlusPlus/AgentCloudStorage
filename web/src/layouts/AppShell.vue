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
      <RouterLink class="sidebar-brand" :to="{ name: 'home' }" aria-label="云仓首页"><BrandMark /><span><b>云仓</b><small>AgentCloud Storage</small></span></RouterLink>
      <div class="workspace-label">文件管理</div>
      <nav class="side-nav" aria-label="主导航">
        <RouterLink class="nav-item" :class="{ selected: route.name === 'home' || route.name === 'search' }" :to="{ name: 'home' }"><span class="nav-icon">▤</span><span>我的文件</span></RouterLink>
        <RouterLink class="nav-item" :class="{ selected: route.name === 'trash' }" :to="{ name: 'trash' }"><span class="nav-icon">⌑</span><span>回收站</span></RouterLink>
      </nav>
      <div class="sidebar-version">安心存放，随时取用</div>
    </aside>
    <section class="shell-main">
      <header class="shell-header"><div class="breadcrumb"><span>我的空间</span><i>/</i><b>{{ sectionName }}</b></div><div class="user-area"><span class="user-avatar" aria-hidden="true">{{ auth.user.value?.email?.slice(0, 1).toUpperCase() || '我' }}</span><span class="user-email">{{ auth.user.value?.email }}</span><button class="logout-button" type="button" @click="logout">退出</button></div></header>
      <RouterView />
    </section>
  </main>
</template>
