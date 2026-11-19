import { ImageDecoder } from "./components/ImageDecoder";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] text-stone-900">
      <header className="border-b border-stone-200 bg-[#FBF9F5]">
        <div className="max-w-[1040px] mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-serif text-xl font-semibold tracking-tight text-stone-950 whitespace-nowrap">
            SUPER PROMPT
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-start">
        <ImageDecoder />
      </main>
    </div>
  );
}
