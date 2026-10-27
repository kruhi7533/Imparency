const CARD = "rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]";

export default function AdminDashboardLoading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-8 sm:px-6 lg:px-8 motion-safe:animate-pulse" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2">
        <div className="h-9 w-72 rounded-lg bg-gray-200" />
        <div className="h-4 w-96 max-w-full rounded bg-gray-200/70" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`${CARD} flex items-start justify-between p-5`}>
            <div className="space-y-3">
              <div className="h-3 w-24 rounded bg-gray-200" />
              <div className="h-7 w-20 rounded bg-gray-200" />
              <div className="h-3 w-32 rounded bg-gray-100" />
            </div>
            <div className="h-10 w-10 rounded-full bg-gray-100" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className={`${CARD} h-80 p-6 xl:col-span-2`}>
          <div className="h-4 w-56 rounded bg-gray-200" />
          <div className="mt-6 h-56 rounded-lg bg-gray-100" />
        </div>
        <div className={`${CARD} h-80 p-6`}>
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="mx-auto mt-8 h-40 w-40 rounded-full bg-gray-100" />
        </div>
      </div>
      <div className={`${CARD} space-y-3 p-6`}>
        <div className="h-4 w-40 rounded bg-gray-200" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
