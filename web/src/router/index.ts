import { createRouter, createWebHistory } from 'vue-router'
import { auth } from '../stores/auth'
import AuthPage from '../pages/AuthPage.vue'
import AppShell from '../layouts/AppShell.vue'
import FileWorkbench from '../pages/FileWorkbench.vue'
import TrashPage from '../pages/TrashPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: AuthPage, meta: { guestOnly: true } },
    {
      path: '/', component: AppShell, meta: { requiresAuth: true }, children: [
        { path: '', name: 'home', component: FileWorkbench },
        { path: 'trash', name: 'trash', component: TrashPage },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !auth.isAuthenticated.value) {
    auth.clear()
    return { name: 'login' }
  }
  if (to.meta.guestOnly && auth.isAuthenticated.value) return { name: 'home' }
})
