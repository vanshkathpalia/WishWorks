/**
 * PromptEditor.tsx — open a prompt, read it, change it, keep what it used to say.
 *
 * The prompts are the product: WW-070, WW-072, WW-082, WW-095 and WW-096 were every one of them
 * a prompt edit. All of those were made blind — change the file, hope, find out on the next
 * listing. Dated versions turn "the copy got worse after Tuesday" from a feeling into something
 * you can open and read.
 *
 * Nothing is ever deleted here. A prompt is a few kilobytes; the point is that a bad edit costs
 * nothing to undo.
 */

import React, { useEffect, useState } from "react";
import type { PromptFile } from "../shared.js";
import { CopyButton } from "./ui.js";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function PromptEditor({ file, close }: { file: string; close: () => void }) {
  const [prompt, setPrompt] = useState<PromptFile | null>(null);
  const [text, setText] = useState("");
  const [viewing, setViewing] = useState<{ saved: string; text: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void window.ww.readPrompt(file).then((p) => {
      setPrompt(p);
      setText(p.text);
    });
  }, [file]);

  const readOnly = prompt?.readOnly ?? false;
  const dirty = prompt !== null && !readOnly && text !== prompt.text;

  async function save() {
    const p = await window.ww.savePrompt(file, text);
    setPrompt(p);
    setText(p.text);
    setSaved(`Saved. The previous version is kept below.`);
    setTimeout(() => setSaved(null), 4000);
  }

  return (
    <div className="modal" onClick={close}>
      <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <h2>{file}</h2>
          <CopyButton text={text} label="Copy the prompt" />
          {!readOnly && (
            <button className="primary" disabled={!dirty} onClick={() => void save()}>
              {dirty ? "Save changes" : "Saved"}
            </button>
          )}
        </div>

        <p className="muted">
          {text.length.toLocaleString()} characters
          {prompt?.edited && " · this machine has its own edited copy"}
          {prompt?.savesTo && <> · saves to {prompt.savesTo}</>}
        </p>

        {/* Read-only in the installed app, and said out loud rather than left as a box that
            will not type. The prompts ship WITH the app, so an edit here would live on this
            machine only and would then outrank every future release — silently, for that one
            file. Changing a prompt is a release. */}
        {readOnly && (
          <p className="problems">
            <b>This prompt is read-only here.</b> The prompts ship inside the app, so changing one
            is a new version rather than a setting — that way both machines are always running the
            same prompt, and a fix reaches everyone. Read it, copy it, and ask for a change; it
            arrives with the next update.
          </p>
        )}

        {prompt?.ignoredOverride && (
          <p className="problems">
            <b>An older version of this app saved an edited copy of this prompt on this machine,
            and it is no longer being used.</b> What you are reading is the one that shipped. The
            old file is still on disk at <span className="path">{prompt.ignoredOverride}</span> if
            anything in it is worth keeping — send it over and it can go into the next release.
          </p>
        )}

        <textarea
          className="editor"
          value={text}
          spellCheck={false}
          readOnly={readOnly}
          onChange={(e) => setText(e.target.value)}
        />
        {saved && <p className="muted">{saved}</p>}
        {dirty && <p className="muted">Unsaved changes — closing this loses them.</p>}

        <h3>Earlier versions</h3>
        {prompt && prompt.versions.length === 0 ? (
          <p className="muted">
            None yet. The first time you save a change, what it said before is kept here with the
            date.
          </p>
        ) : (
          <ul className="versions">
            {prompt?.versions.map((v) => (
              <li key={v.file}>
                <b>{when(v.saved)}</b>
                <span className="muted">{v.length.toLocaleString()} characters</span>
                <button
                  onClick={() =>
                    void window.ww.readVersion(v.file).then((t) => setViewing({ saved: v.saved, text: t }))
                  }
                >
                  Look at it
                </button>
                {!readOnly && (
                  <button
                    onClick={() =>
                      void window.ww.readVersion(v.file).then((t) => {
                        // Restoring is an ordinary edit: it goes through save, so the version you
                        // are replacing is itself kept. Nothing here is a one-way door.
                        setText(t);
                        setViewing(null);
                      })
                    }
                  >
                    Put it back
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {viewing && (
          <>
            <h3>What it said on {when(viewing.saved)}</h3>
            <pre className="value tall">{viewing.text}</pre>
          </>
        )}

        <button className="close" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
