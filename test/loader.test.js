import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('真实 dist 客户端可按宿主 loader 执行并注册一个 BISHENG 工作台', () => {
  const code = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')
  let definition = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          assert.equal(definition, null, '同一 bundle 只能注册一个客户端模块')
          definition = value
        },
      },
    },
    console,
  }
  vm.runInNewContext(code, sandbox, { filename: 'dist/client.js' })
  assert.ok(definition)
  assert.equal(definition.id, pkg.name)

  const contextValue = {}
  const React = new Proxy({
    createElement: (...args) => ({ args }),
    createContext: value => ({ Provider: contextValue, Consumer: contextValue, _currentValue: value }),
  }, {
    get(target, key) {
      if (key in target) return target[key]
      return () => undefined
    },
  })
  const client = definition.factory(id => {
    assert.equal(id, 'react', '客户端只应 require 宿主共享 React')
    return React
  })
  assert.deepEqual(Array.from(client.inject), ['desktopWorkbenches', 'uiSession', 'uiWorkspace'])

  let descriptor = null
  let Panel = null
  let disposed = false
  const ctx = {
    effect(fn) { return fn() },
    desktopWorkbenches: {
      register(value, component) {
        assert.equal(descriptor, null, '同一客户端只能注册一个工作台')
        descriptor = value
        Panel = component
        return () => { disposed = true }
      },
    },
  }
  client.apply(ctx)
  assert.ok(descriptor)
  assert.equal(descriptor.title, '自媒体工作台 · BISHENG 版')
  assert.equal(descriptor.panelTitle, '灵感与内容创作')
  assert.equal(descriptor.repository, 'https://github.com/caisiyang123/dsh-media-desk-bisheng')
  assert.equal(descriptor.customFrame, true)
  assert.equal(descriptor.id, undefined)
  assert.equal(descriptor.workbenchId, undefined)
  assert.equal(typeof Panel, 'function')
  assert.equal(disposed, false, '注册释放函数应由宿主在卸载时调用，而非注册时调用')
})
