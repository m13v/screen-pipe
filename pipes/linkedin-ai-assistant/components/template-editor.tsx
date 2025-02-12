"use client";

import { useState } from "react";

interface Template {
  'paste-here-url-from-linkedin-with-2nd-grade-connections': string;
  'request-for-intro-prompt-to-ai': string;
  'llm-appraisal-prompt': string;
  'llm-user-reply-needs-response-prompt': string;
}

interface TemplateEditorProps {
  initialTemplate: Template;
  defaultOpen?: boolean;
}

export default function TemplateEditor({ initialTemplate, defaultOpen = true }: TemplateEditorProps) {
  const [template, setTemplate] = useState(initialTemplate);

  const handleChange = (key: keyof Template, value: string) => {
    setTemplate(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = () => {
    try {
      console.log("Template saved:", template);
      // TODO: Implement save logic
    } catch (error) {
      console.error("error saving template:", error);
    }
  };

  return (
    <div className={`w-full max-w-7xl flex flex-col gap-6 ${defaultOpen ? '' : 'hidden'}`}>
      <h2 className="text-xl font-semibold">edit template</h2>
      <div className="flex flex-col gap-6">
        {Object.entries(template).map(([key, value]) => (
          <div key={key} className="flex flex-col gap-2">
            <label className="text-sm font-medium">{key.replace(/_/g, ' ')}</label>
            <textarea
              className="w-full min-h-[100px] p-4 border rounded-lg font-mono text-sm 
                bg-white dark:bg-black text-black dark:text-white resize-vertical"
              value={value}
              onChange={(e) => handleChange(key as keyof Template, e.target.value)}
              placeholder={`Enter ${key}...`}
            />
          </div>
        ))}
      </div>
      <button
        className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 w-fit"
        onClick={handleSave}
      >
        save changes
      </button>
    </div>
  );
} 