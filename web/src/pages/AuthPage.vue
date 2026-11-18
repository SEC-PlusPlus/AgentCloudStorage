<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { login } from '../api/auth'
import BrandMark from '../components/BrandMark.vue'
import StorageScene from '../components/StorageScene.vue'
import { auth } from '../stores/auth'

const router = useRouter()
const form = reactive({ email: '', password: '' })
const busy = ref(false)
const errorMessage = ref('')

async function submit() {
  errorMessage.value = ''
  busy.value = true
  try {
    const result = await login(form.email.trim(), form.password)
    auth.setSession(result.access_token, result.expires_at, result.user)
    await router.replace({ name: 'home' })
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : '操作失败，请稍后重试。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <header class="auth-topline">
      <div class="login-wordmark"><BrandMark /><span>GoVault</span></div>
      <span class="topline-status">给文件一个安稳的去处</span>
    </header>
    <div class="auth-layout">
      <section class="auth-story" aria-label="产品介绍">
        <div class="story-kicker"><span class="kicker-line" /> GO 编写的私人文件空间</div>
        <h1>文件有序，<br /><span>生活从容。</span></h1>
        <p class="story-copy">上传、整理、预览与提问，都在你自己的云仓里。简单打开，安心存放。</p>
        <StorageScene />
      </section>

      <section class="auth-card" aria-labelledby="form-title">
        <div class="card-heading"><div><span class="eyebrow">欢迎来到 GoVault</span><h2 id="form-title">继续管理你的文件</h2></div></div>
        <p class="card-subtitle">使用邮箱和密码登录。</p>
        <el-form class="auth-form" :model="form" label-position="top" @submit.prevent="submit">
          <el-form-item label="邮箱" prop="email"><el-input v-model="form.email" autocomplete="email" type="email" required placeholder="name@example.com" /></el-form-item>
          <el-form-item label="密码" prop="password"><el-input v-model="form.password" autocomplete="current-password" type="password" maxlength="72" required show-password placeholder="输入你的密码" /></el-form-item>
          <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false" role="alert" />
          <el-button class="submit-button" type="primary" native-type="submit" :loading="busy">进入我的云仓</el-button>
        </el-form>
        <p class="privacy-note">仅在你的云仓中使用账号信息。</p>
      </section>
    </div>
    <footer class="auth-footer"><span>GoVault · Personal storage</span><span>由 Go 驱动</span></footer>
  </main>
</template>
