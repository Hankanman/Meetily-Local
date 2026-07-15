"use client";

import React from "react";

import { Heading } from "@/components/ui/typography";

interface MainNavProps {
  title: string;
}

const MainNav: React.FC<MainNavProps> = ({ title }) => {
  return (
    <div className="flex h-0 items-center border-b">
      <div className="mx-auto w-full max-w-5xl px-8">
        <Heading level={1}>{title}</Heading>
      </div>
    </div>
  );
};

export default MainNav;
