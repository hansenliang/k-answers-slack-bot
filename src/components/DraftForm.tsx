'use client';

import { useState, useEffect } from 'react';
import QuestionsForm from './QuestionsForm';

interface Question {
  id: string;
  text: string;
}

export default function DraftForm() {
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('Name your PRD');
  const [showQuery, setShowQuery] = useState(false);
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [queryResults, setQueryResults] = useState('');
  const [summary, setSummary] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showPrdsLink, setShowPrdsLink] = useState(false);
  const [prdLink, setPrdLink] = useState<string | null>(null);
  const [showQuestions, setShowQuestions] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);

  // Load saved state from localStorage
  useEffect(() => {
    const savedState = localStorage.getItem('draftFormState');
    if (savedState) {
      const { title, query, showQuery, questions, showQuestions, submitted, showPrdsLink, prdLink } = JSON.parse(savedState);
      setTitle(title);
      setQuery(query);
      setShowQuery(showQuery);
      setQuestions(questions);
      setShowQuestions(showQuestions);
      setSubmitted(submitted);
      setShowPrdsLink(showPrdsLink);
      setPrdLink(prdLink);
    }
  }, []);

  // Save state to localStorage
  useEffect(() => {
    if (title || query || questions.length > 0 || submitted) {
      localStorage.setItem('draftFormState', JSON.stringify({
        title,
        query,
        showQuery,
        questions,
        showQuestions,
        submitted,
        showPrdsLink,
        prdLink
      }));
    }
  }, [title, query, showQuery, questions, showQuestions, submitted, showPrdsLink, prdLink]);

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && title.trim() !== '') {
      e.preventDefault();
      setShowQuery(true);
      setReadyToSubmit(true);
    }
  };

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setShowPrdsLink(false);
    setIsGenerating(true);
    setIsGeneratingQuestions(true);
    
    try {
      console.log('Starting question generation...');
      // First, get questions from OpenAI
      const questionsResponse = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          query,
        }),
      });

      if (!questionsResponse.ok) {
        throw new Error('Failed to generate questions');
      }

      const questionsData = await questionsResponse.json();
      console.log('Questions API response:', questionsData);
      
      if (!questionsData.questions || questionsData.questions.length === 0) {
        throw new Error('No questions generated');
      }

      setQuestions(questionsData.questions);
      setShowQuestions(true);
      setIsGenerating(false);
      setIsGeneratingQuestions(false);
    } catch (error) {
      console.error('Error generating questions:', error);
      setIsGenerating(false);
      setIsGeneratingQuestions(false);
      // Fallback to direct PRD generation if question generation fails
      await generatePRD();
    }
  };

  const generatePRD = async (questionAnswers?: Record<string, string>) => {
    try {
      setIsGenerating(true);
      setIsGeneratingQuestions(false);
      // Get stored context from localStorage
      const storedContext = localStorage.getItem('personalContext');

      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          query,
          storedContext,
          questionAnswers,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process query');
      }

      setShowPrdsLink(true);
      const data = await response.json();
      const url = data.url;
      const returnedTitle = data.title;
      const docId = data.docId;
      setQueryResults(data || '');
      setSummary(data || '');
      setDriveUrl(data || '');
      setPrdLink(data.driveUrl || data.url || null);

      if (data && data.url) {
        const savedPrds = JSON.parse(localStorage.getItem('savedPRD') || '[]');
        savedPrds.push({
          url: url,
          title: returnedTitle,
          createdAt: new Date().toISOString(),
          id: docId,
        });
        localStorage.setItem('savedPRD', JSON.stringify(savedPrds));
      }

      // Clear the draft form state after successful PRD generation
      localStorage.removeItem('draftFormState');
      setIsGenerating(false);
    } catch (error) {
      console.error('Error processing query:', error);
      setQueryResults('Failed to process query');
      setDriveUrl('');
      setIsGenerating(false);
    }
  };

  const handleQuestionsSubmit = async (answers: Record<string, string>) => {
    setShowQuestions(false);
    setIsGenerating(true);
    setIsGeneratingQuestions(false);
    await generatePRD(answers);
  };

  const handleDraftAnother = () => {
    // Reset all state
    setTitle('');
    setQuery('');
    setShowQuery(false);
    setReadyToSubmit(false);
    setQueryResults('');
    setSummary('');
    setDriveUrl('');
    setSubmitted(false);
    setShowPrdsLink(false);
    setPrdLink(null);
    setShowQuestions(false);
    setQuestions([]);
    setIsGenerating(false);
    setIsGeneratingQuestions(false);
    // Clear localStorage
    localStorage.removeItem('draftFormState');
  };

  if (showQuestions) {
    return <QuestionsForm questions={questions} onSubmit={handleQuestionsSubmit} />;
  }

  return (
    <div>
      {!submitted ? (
        <form onSubmit={handleQuery} className="space-y-4">
          <div>
            {!showQuery && (
              <div className="flex items-center gap-2">
                <input
                  id="title"
                  type="text"
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  className="flex-1 rounded-md border border-[#E9DCC6] bg-white px-3 py-2 text-[#232426] shadow-sm focus:border-[#EF6351] focus:outline-none focus:ring-1 focus:ring-[#EF6351]"
                  placeholder="Give your PRD a title..."
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => title.trim() && setShowQuery(true)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors
                    ${title.trim() ? 'bg-[#EF6351] text-white hover:bg-[#d94d38] cursor-pointer focus:ring-[#EF6351]' : 'bg-[#E9DCC6] text-white cursor-not-allowed'}
                  `}
                  tabIndex={-1}
                  disabled={!title.trim()}
                >
                  <svg
                    className="w-5 h-5 transition-transform duration-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          <div>
            {showQuery && (
              <div className="flex items-center gap-2">
                <textarea
                  id="query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  rows={4}
                  className="flex-1 rounded-md border border-[#E9DCC6] bg-white px-3 py-2 text-[#232426] shadow-sm focus:border-[#EF6351] focus:outline-none focus:ring-1 focus:ring-[#EF6351]"
                  placeholder="Ask ChatPRD to help draft your PRD..."
                  required
                  autoFocus
                />
                <button
                  type="submit"
                  className="w-10 h-10 rounded-full bg-[#EF6351] flex items-center justify-center text-white shadow-md hover:bg-[#d94d38] focus:outline-none focus:ring-2 focus:ring-[#EF6351] focus:ring-offset-2 transition-colors"
                >
                  <svg className="w-5 h-5 transition-transform duration-300 rotate-[-90deg]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </form>
      ) : (
        <div className="text-center flex flex-col items-center gap-4">
          <div className="text-lg font-semibold text-[#232426]">
            {isGenerating ? (
              isGeneratingQuestions 
                ? 'Sit tight! We\'re going to ask you a few clarifying questions to help us create the best possible PRD for you.'
                : 'We\'re on it, greatness incoming'
            ) : (prdLink ? 'First draft complete!' : 'Something went wrong')}
          </div>
          <div className="text-base text-[#232426]">
            <span className="font-bold">Title:</span> {title}
          </div>
          <div className="text-base text-[#232426]">
            <span className="font-bold">Prompt:</span> {query}
          </div>
          {showPrdsLink && prdLink && (
            <div className="flex flex-col gap-4">
              <a
                href={prdLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block rounded-full bg-[#EF6351] px-6 py-2 text-white font-bold hover:bg-[#d94d38] transition-colors"
              >
                View PRD in Google Drive
              </a>
              <button
                onClick={handleDraftAnother}
                className="mt-2 inline-block rounded-full bg-[#E9DCC6] px-6 py-2 text-[#232426] font-bold hover:bg-[#d4c8b0] transition-colors"
              >
                Draft Another
              </button>
            </div>
          )}
          {!isGenerating && !prdLink && (
            <button
              onClick={handleDraftAnother}
              className="mt-2 inline-block rounded-full bg-[#E9DCC6] px-6 py-2 text-[#232426] font-bold hover:bg-[#d4c8b0] transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
} 