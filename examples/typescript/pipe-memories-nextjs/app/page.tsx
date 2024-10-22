'use client';

import Image from "next/image";
import MemoriesList from "../components/memories";

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start justify-center">
        <Image src="https://screenpi.pe/1024x1024.png" width={24} height={24} alt="Description" />
        <span className="text-sm text-gray-500">
          your memories will appear here,
          but first you need to run the script
        </span>
        <MemoriesList />
      </main>
    </div>
  );
}
