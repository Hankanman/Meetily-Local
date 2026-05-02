import React from "react";
import { Clock, Users, Calendar, Tag } from "lucide-react";

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

interface Note {
  title: string;
  date: string;
  time?: string;
  attendees?: string[];
  tags: string[];
  content: string;
}

export function generateStaticParams() {
  // Return all possible note IDs
  return [
    { id: "team-sync-dec-26" },
    { id: "product-review" },
    { id: "project-ideas" },
    { id: "action-items" },
  ];
}

const NotePage = async (props: PageProps) => {
  const params = await props.params;
  // This would normally come from your database
  const sampleData: Record<string, Note> = {
    "team-sync-dec-26": {
      title: "Team Sync - Dec 26",
      date: "2024-12-26",
      time: "10:00 AM - 11:00 AM",
      attendees: ["John Doe", "Jane Smith", "Mike Johnson"],
      tags: ["Team Sync", "Weekly", "Product"],
      content: `
# Meeting Summary
Team sync discussion about Q1 2024 goals and current project status.

## Agenda Items
1. Project Status Updates
2. Q1 2024 Planning
3. Team Concerns & Feedback

## Key Decisions
- Prioritized mobile app development for Q1
- Scheduled weekly design reviews
- Added two new features to the roadmap

## Action Items
- [ ] John: Create project timeline
- [ ] Jane: Schedule design review meetings
- [ ] Mike: Update documentation

## Notes
- Discussed current project bottlenecks
- Reviewed customer feedback from last release
- Planned resource allocation for upcoming sprint
      `,
    },
    "product-review": {
      title: "Product Review",
      date: "2024-12-26",
      time: "2:00 PM - 3:00 PM",
      attendees: ["Sarah Wilson", "Tom Brown", "Alex Chen"],
      tags: ["Product", "Review", "Quarterly"],
      content: `
# Product Review Meeting

## Overview
Quarterly product review session with stakeholders.

## Discussion Points
1. Q4 Performance Review
2. Feature Prioritization
3. Customer Feedback Analysis

## Action Items
- [ ] Update product roadmap
- [ ] Schedule user research sessions
- [ ] Review competitor analysis
      `,
    },
    "project-ideas": {
      title: "Project Ideas",
      date: "2024-12-26",
      tags: ["Ideas", "Planning"],
      content: `
# Project Ideas

## New Features
1. AI-powered meeting summaries
2. Calendar integration
3. Team collaboration tools

## Improvements
- Enhanced search functionality
- Better note organization
- Real-time collaboration
      `,
    },
    "action-items": {
      title: "Action Items",
      date: "2024-12-26",
      tags: ["Tasks", "Todo", "Planning"],
      content: `
# Action Items

## High Priority
- [ ] Deploy v2.0 to production
- [ ] Fix critical security issues
- [ ] Complete user documentation

## Medium Priority
- [ ] Update dependencies
- [ ] Implement error tracking
- [ ] Add unit tests

## Low Priority
- [ ] Refactor legacy code
- [ ] Improve code documentation
- [ ] Setup development guidelines
      `,
    },
  };

  const note = sampleData[params.id as keyof typeof sampleData];

  if (!note) {
    return <div className="p-8">Note not found</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-8">
        <h1 className="mb-4 text-3xl font-bold">{note.title}</h1>

        <div className="flex flex-wrap gap-4 text-muted-foreground">
          {note.date && (
            <div className="flex items-center gap-1">
              <Calendar className="size-4" />
              <span>{note.date}</span>
            </div>
          )}

          {note.time && (
            <div className="flex items-center gap-1">
              <Clock className="size-4" />
              <span>{note.time}</span>
            </div>
          )}

          {note.attendees && (
            <div className="flex items-center gap-1">
              <Users className="size-4" />
              <span>{note.attendees.join(", ")}</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          {note.tags.map((tag) => (
            <div
              key={tag}
              className="
                flex items-center gap-1 rounded-full bg-blue-600/15 px-2 py-1
                text-sm text-blue-800
              "
            >
              <Tag className="size-3" />
              {tag}
            </div>
          ))}
        </div>
      </div>

      <div className="
        prose max-w-none prose-blue
        dark:prose-invert
      ">
        <div
          dangerouslySetInnerHTML={{
            __html: note.content
              .split("\n")
              .map((line) => {
                if (line.startsWith("# ")) {
                  return `<h1>${line.slice(2)}</h1>`;
                } else if (line.startsWith("## ")) {
                  return `<h2>${line.slice(3)}</h2>`;
                } else if (line.startsWith("- ")) {
                  return `<li>${line.slice(2)}</li>`;
                }
                return line;
              })
              .join("\n"),
          }}
        />
      </div>
    </div>
  );
};

export default NotePage;
