"use client";

import dynamic from "next/dynamic";

/**
 * Defers the assistant widget out of the initial bundle for every route.
 *
 * `AssistantWidget` is a floating launcher that nothing on first paint depends
 * on, but it lives in the root layout, so its dependencies — framer-motion and
 * lucide-react — were compiled into every single route in the app.
 *
 * This wrapper exists because `next/dynamic` with `ssr: false` is only allowed
 * in a Client Component, and `app/layout.tsx` is a Server Component. Rendering
 * it client-side only is correct regardless of the build cost: the widget is
 * interactive-only and there is nothing about it worth server-rendering.
 */
const AssistantWidget = dynamic(() => import("./AssistantWidget"), { ssr: false });

export default function AssistantWidgetLoader() {
  return <AssistantWidget />;
}
