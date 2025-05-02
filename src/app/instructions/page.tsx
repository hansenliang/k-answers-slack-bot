import Sidebar from '@/components/Sidebar';

export default function Instructions() {
  return (
    <div className="min-h-screen bg-[#FFFAF3]">
      <Sidebar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm p-8">
          <h1 className="text-3xl font-semibold text-[#232426] mb-8">How to Use K:Answers bot</h1>
          
          <div className="space-y-8">
            <section>
              <h2 className="text-2xl font-semibold text-[#232426] mb-4">1. Store Your Information</h2>
              <p className="text-[#232426] mb-4">
                Start by providing your personal context in the Store Information section. This helps K:Answers bot understand your background and preferences.
              </p>
              <ul className="list-disc pl-6 space-y-2 text-[#232426]">
                <li>Enter your personal background and experience</li>
                <li>Describe your team goals and objectives</li>
                <li>List key terms and background information</li>
                <li>Share examples of your thinking process</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#232426] mb-4">2. Query Information</h2>
              <p className="text-[#232426] mb-4">
                Use the query section to ask questions or request information. K:Answers bot will use your stored context to provide relevant responses.
              </p>
              <ul className="list-disc pl-6 space-y-2 text-[#232426]">
                <li>Enter your question or request in the search box</li>
                <li>Click Search to get a response</li>
                <li>View the generated response in the results section</li>
                <li>Click the link to view your generated PRD</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#232426] mb-4">3. Sync PRDs</h2>
              <p className="text-[#232426] mb-4">
                Connect your Google Drive to sync and manage your PRDs.
              </p>
              <ul className="list-disc pl-6 space-y-2 text-[#232426]">
                <li>Enter your Google Drive folder ID</li>
                <li>Click Sync PRDs to connect</li>
                <li>View your synced documents in the list below</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-[#232426] mb-4">Tips for Best Results</h2>
              <ul className="list-disc pl-6 space-y-2 text-[#232426]">
                <li>Be specific in your queries to get more relevant responses</li>
                <li>Update your stored information regularly to keep it current</li>
                <li>Use clear and concise language in your queries</li>
                <li>Review and edit generated PRDs as needed</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
} 