import { useState } from 'react';
import { Layout } from './components/Layout';
import { Opportunities } from './components/Opportunities';
import { Analysis } from './components/Analysis';

export default function App() {
  const [screen, setScreen] = useState<'opportunities' | 'analysis'>('opportunities');
  const [analysisContext, setAnalysisContext] = useState<{
    opportunityId: string;
    opportunityTitle: string;
  } | null>(null);

  const openAnalysis = (opportunityId: string, opportunityTitle: string) => {
    setAnalysisContext({ opportunityId, opportunityTitle });
    setScreen('analysis');
  };

  return (
    <Layout
      screen={screen}
      breadcrumbCurrent={analysisContext?.opportunityTitle}
      onNav={(s) => {
        setScreen(s);
        if (s === 'opportunities') setAnalysisContext(null);
      }}
    >
      {screen === 'opportunities' && (
        <Opportunities onOpenAnalysis={openAnalysis} />
      )}
      {screen === 'analysis' && analysisContext && (
        <Analysis
          opportunityId={analysisContext.opportunityId}
          opportunityTitle={analysisContext.opportunityTitle}
          onBack={() => {
            setScreen('opportunities');
            setAnalysisContext(null);
          }}
        />
      )}
    </Layout>
  );
}
