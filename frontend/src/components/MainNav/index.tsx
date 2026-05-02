"use client";

import React from "react";

interface MainNavProps {
  title: string;
}

const MainNav: React.FC<MainNavProps> = ({ title }) => {
  return (
    <div className="flex h-0 items-center border-b">
      <div className="mx-auto w-full max-w-5xl px-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>
    </div>
  );
};

export default MainNav;
