<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { login, register } from '../api/auth'
import BrandMark from '../components/BrandMark.vue'
import { auth } from '../stores/auth'

const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const username = ref('')
const email = ref('')
const password = ref('')
const busy = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const isRegister = computed(() => mode.value === 'register')

function changeMode(next: 'login' | 'register') {
  mode.value = next
  errorMessage.value = ''
  successMessage.value = ''
  password.value = ''
}

async function submit() {
  errorMessage.value = ''
  successMessage.value = ''
  busy.value = true
  try {
    if (isRegister.value) {
      await register(username.value.trim(), email.value.trim(), password.value)
      successMessage.value = '账号创建成功，请使用邮箱和密码登录。'
      mode.value = 'login'
      password.value = ''
    } else {
      const result = await login(email.value.trim(), password.value)
      auth.setSession(result.access_token, result.expires_at, result.user)
      await router.replace({ name: 'home' })
    }
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
      <span class="topline-status">个人文件空间</span>
    </header>
    <div class="auth-layout">
      <section class="auth-story" aria-label="产品介绍">
        <div class="story-kicker"><span class="kicker-line" /> GO 编写 · 私人文件空间</div>
        <h1>把文件，<br /><span>放回自己的空间</span></h1>
        <p class="story-copy">一个由 Go 驱动的个人云仓。文件由你管理，存储运行在自己的服务上。</p>
        <figure class="mascot-stage">
          <img class="pixel-mascot" src="/images/go-mouse-pixel-v2.png" alt="以参考图中的蓝色 Go 鼠为原型绘制的像素角色" />
          <figcaption class="mascot-caption">GO VAULT <span aria-hidden="true">/</span> PERSONAL STORAGE</figcaption>
        </figure>
      </section>

      <section class="auth-card" aria-labelledby="form-title">
        <div class="card-heading"><div><span class="eyebrow">账号</span><h2 id="form-title">{{ isRegister ? '创建账号' : '登录 GoVault' }}</h2></div></div>
        <p class="card-subtitle">{{ isRegister ? '创建账号，开始管理个人文件。' : '使用邮箱和密码继续。' }}</p>
        <div class="mode-switch" role="tablist" aria-label="账号操作">
          <button type="button" role="tab" :aria-selected="!isRegister" :class="{ active: !isRegister }" @click="changeMode('login')">登录</button>
          <button type="button" role="tab" :aria-selected="isRegister" :class="{ active: isRegister }" @click="changeMode('register')">注册</button>
        </div>
        <form class="auth-form" @submit.prevent="submit">
          <label v-if="isRegister" class="field"><span>用户名</span><input v-model="username" autocomplete="username" minlength="3" maxlength="32" placeholder="至少 3 个字符" required /></label>
          <label class="field"><span>邮箱</span><input v-model="email" type="email" autocomplete="email" placeholder="name@example.com" required /></label>
          <label class="field"><span>密码</span><input v-model="password" type="password" :autocomplete="isRegister ? 'new-password' : 'current-password'" :minlength="isRegister ? 8 : undefined" maxlength="72" :placeholder="isRegister ? '至少 8 个字符' : '输入你的密码'" required /></label>
          <p v-if="errorMessage" class="form-message error" role="alert">{{ errorMessage }}</p>
          <p v-if="successMessage" class="form-message success" role="status">{{ successMessage }}</p>
          <button class="submit-button" type="submit" :disabled="busy">
            <span>{{ busy ? '请稍候…' : isRegister ? '创建账号' : '进入我的云仓' }}</span>
            <span class="button-arrow" aria-hidden="true">↗</span>
          </button>
        </form>
        <p class="privacy-note">账号信息仅用于登录个人云仓。</p>
      </section>
    </div>
    <footer class="auth-footer"><span>GoVault</span><span>由 Go 驱动</span></footer>
  </main>
</template>
