<script setup lang="ts">
/**
 * CanvasRoot renders Skia but does not attach pointer handlers — useCanvasInput does.
 * Without this bridge every tool looks "dead" even when setActiveTool succeeds.
 */
import { useCanvasContext, useCanvasInput, useEditor, useTextEdit } from '@open-pencil/vue'

const editor = useEditor()
const {
  canvasRef,
  hitTestSectionTitle,
  hitTestComponentLabel,
  hitTestFrameTitle,
} = useCanvasContext()

useCanvasInput(
  canvasRef,
  editor,
  hitTestSectionTitle,
  hitTestComponentLabel,
  hitTestFrameTitle,
)
useTextEdit(canvasRef, editor)
</script>

<template><!-- headless input wiring --></template>
