'use client';

import { useState, useEffect } from 'react';
import Toast from './Toast';

interface FormData {
  teamStrategy: string;
  howYouThinkAboutProduct: string;
  pillarGoalsKeyTermsBackground: string;
  examplesOfHowYouThink: string;
}

interface Step {
  id: keyof FormData;
  label: string;
  placeholder: string;
  rows: number;
}

export default function ContextForm() {
  // State
  const [formData, setFormData] = useState<FormData>({
    teamStrategy: '',
    howYouThinkAboutProduct: '',
    pillarGoalsKeyTermsBackground: '',
    examplesOfHowYouThink: '',
  });
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [editorValue, setEditorValue] = useState('');

  // Constants
  const steps: Step[] = [
    {
      id: 'teamStrategy',
      label: 'Team Strategy',
      placeholder: 'Provide the text of the best strategy document you have for your product area, or provide a view of where you want your product to be a year from now',
      rows: 4
    },
    {
      id: 'howYouThinkAboutProduct',
      label: 'How you think about Product',
      placeholder: 'Give a few examples of how you\'ve solved problems in the past with your product area, and how you generally approach developing your product area. This will help give K:Answers bot of how you think about developing your product area.',
      rows: 4
    },
    {
      id: 'pillarGoalsKeyTermsBackground',
      label: 'Pillar Goals, Key Terms, and Background',
      placeholder: 'Provide context about the teams in your pillar, how you\'re product area fits into that pillar achieving the business goals, and any other background information that will help K:Answers bot understand the bigger picture and write a better PRD.',
      rows: 2
    },
    {
      id: 'examplesOfHowYouThink',
      label: 'Examples of how you think',
      placeholder: 'Past the markdown text of an example PRD that has additional context written by you explaining why you wrote things the way you did, and why the structure of the document is important. The more you provide about how you think and why the PRD looks the way it does, the better your results will be.',
      rows: 4
    }
  ];

  // Effects
  useEffect(() => {
    const storedContext = localStorage.getItem('personalContext');
    if (storedContext) {
      try {
        const parsedContext = JSON.parse(storedContext);
        setFormData(prev => ({
          ...prev,
          ...parsedContext
        }));
      } catch (error) {
        console.error('Error parsing stored context:', error);
      }
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentStep > 0) {
        e.preventDefault();
        setCurrentStep(prev => prev - 1);
      } else if (e.key === 'ArrowRight' && currentStep < steps.length - 1) {
        e.preventDefault();
        setCurrentStep(prev => prev + 1);
      } else if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        handleSubmit(e as unknown as React.FormEvent);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, formData]);

  // Handlers
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleStepClick = (index: number) => {
    setCurrentStep(index);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem('personalContext', JSON.stringify(formData));
      setToastMessage('Context updated successfully!');
      setShowToast(true);
    } catch (error) {
      console.error('Error storing context:', error);
      setToastMessage('Failed to update context');
      setShowToast(true);
    }
  };

  const handleOpenEditor = () => {
    setEditorValue(formData[currentStepData.id]);
    setShowEditor(true);
  };

  const handleCloseEditor = () => {
    setFormData(prev => ({
      ...prev,
      [currentStepData.id]: editorValue
    }));
    setShowEditor(false);
  };

  // Derived values
  const currentStepData = steps[currentStep];
  const currentValue = formData[currentStepData.id];
  const isLastStep = currentStep === steps.length - 1;

  // Render
  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 mx-auto">
        <div className="space-y-2">
          <p className="text-4xl font-medium text-[#232426] mb-8 text-center">{currentStepData.label}</p>
          <div className="relative">
            <textarea
              id={currentStepData.id}
              name={currentStepData.id}
              value={currentValue}
              onChange={handleInputChange}
              rows={8}
              className="flex-1 w-full rounded-md border border-[#E9DCC6] bg-white px-3 py-2 text-[#232426] shadow-sm focus:border-[#EF6351] focus:outline-none focus:ring-1 focus:ring-[#EF6351] pr-12 pb-12"
              placeholder={currentStepData.placeholder}
              required
              autoFocus
            />
            <button
              type="button"
              onClick={handleOpenEditor}
              className="absolute bottom-4 right-4 w-8 h-8 rounded-full flex items-center justify-center shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors bg-[#E9DCC6] text-white hover:bg-[#d4c8b0] cursor-pointer focus:ring-[#E9DCC6]"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </div>
          <button
            type={isLastStep ? 'submit' : 'button'}
            onClick={isLastStep ? undefined : handleNext}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors
              ${currentValue.trim() ? 'bg-[#EF6351] text-white hover:bg-[#d94d38] cursor-pointer focus:ring-[#EF6351]' : 'bg-[#E9DCC6] text-white cursor-not-allowed'}
            `}
            disabled={!currentValue.trim()}
          >
            <svg
              className="w-5 h-5 transition-transform duration-300 rotate-[-90deg]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <div className="flex justify-center gap-2">
          {steps.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleStepClick(index)}
              className={`w-2 h-2 rounded-full transition-colors ${
                index === currentStep ? 'bg-[#EF6351]' : 'bg-[#E9DCC6]'
              }`}
              aria-label={`Go to step ${index + 1}`}
            />
          ))}
        </div>
      </form>

      {showEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-[#232426]">{currentStepData.label}</h3>
              <button
                onClick={handleCloseEditor}
                className="text-[#232426] hover:text-[#EF6351]"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <textarea
              value={editorValue}
              onChange={(e) => setEditorValue(e.target.value)}
              className="flex-1 rounded-md border border-[#E9DCC6] px-3 py-2 text-[#232426] shadow-sm focus:border-[#EF6351] focus:outline-none focus:ring-1 focus:ring-[#EF6351] resize-none"
              rows={20}
            />
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleCloseEditor}
                className="px-4 py-2 bg-[#EF6351] text-white rounded-md hover:bg-[#d94d38] transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {showToast && (
        <Toast
          message={toastMessage}
          onClose={() => setShowToast(false)}
        />
      )}
    </>
  );
} 