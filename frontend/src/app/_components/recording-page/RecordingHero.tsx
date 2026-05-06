"use client";

import { useConfig } from "@/contexts/ConfigContext";
import { usePermissionCheck } from "@/hooks/usePermissionCheck";
import { useAudioLevels } from "@/hooks/useAudioLevels";
import { CompactAudioLevelMeter } from "@/components/AudioLevelMeter";
import { DeviceSummary } from "./DeviceSummary";
import { HeroStartButton } from "./HeroStartButton";
import { MeetingNameInput } from "./MeetingNameInput";
import { RecentMeetings } from "./RecentMeetings";

interface RecordingHeroProps {
  onStart: () => void;
  isStarting: boolean;
}

/**
 * Pre-recording landing. Centered hero with device chips + big mic
 * button + meeting name input, recent meetings underneath. The hero
 * also drives the audio-level monitor for the selected devices so the
 * user can see "is my mic alive?" at a glance.
 */
export function RecordingHero({ onStart, isStarting }: RecordingHeroProps) {
  const { selectedDevices } = useConfig();
  const { hasMicrophone } = usePermissionCheck();

  // Watch the selected devices so the user can see them light up before
  // they hit record. Fall back to "default" — the backend's magic name
  // for the system default device — when the user hasn't picked
  // explicitly. Without this fallback the hero shows no meters at all
  // until the user opens the device-chip popover, since selectedDevices
  // is `{ null, null }` on first load.
  const micName = selectedDevices?.micDevice ?? "default";
  const systemName = selectedDevices?.systemDevice ?? "default";
  const monitorNames = Array.from(new Set([micName, systemName]));
  const levels = useAudioLevels(monitorNames);

  const micLevel = levels.get(micName);
  // When both "devices" are the same default the backend emits one
  // entry; render the system row only when it's a distinct device, so
  // we don't show two identical bars side-by-side.
  const systemLevel = micName !== systemName ? levels.get(systemName) : null;

  return (
    // `w-full` is essential — without it the hero sits as a content-sized
    // flex item inside its row-flex parent and visually pins to the left.
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-6 py-10">
      <DeviceSummary disabled={isStarting} />

      <div className="flex flex-col items-center gap-4">
        <HeroStartButton
          onStart={onStart}
          isStarting={isStarting}
          disabled={!hasMicrophone}
        />

        {(micLevel || systemLevel) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {micLevel && (
              <div className="flex items-center gap-2">
                <span>Mic</span>
                <CompactAudioLevelMeter
                  rmsLevel={micLevel.rms_level}
                  peakLevel={micLevel.peak_level}
                  isActive={micLevel.is_active}
                />
              </div>
            )}
            {systemLevel && (
              <div className="flex items-center gap-2">
                <span>System</span>
                <CompactAudioLevelMeter
                  rmsLevel={systemLevel.rms_level}
                  peakLevel={systemLevel.peak_level}
                  isActive={systemLevel.is_active}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <MeetingNameInput />

      <div className="mt-4">
        <RecentMeetings />
      </div>

      {!hasMicrophone && (
        <p className="text-sm text-muted-foreground">
          No microphone detected. Connect one and refresh permissions in
          Settings → Recordings.
        </p>
      )}
    </div>
  );
}
