import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const tabsMeta: ComponentMeta = {
  slug: "tabs",
  name: "Tabs",
  description: "Tabbed content panels.",
  category: "Data Display",
  source: "components/tabs.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <Tabs defaultValue="tab-1">
          <TabsList>
            <TabsTrigger value="tab-1">Overview</TabsTrigger>
            <TabsTrigger value="tab-2">Settings</TabsTrigger>
            <TabsTrigger value="tab-3">Logs</TabsTrigger>
          </TabsList>
          <TabsContent value="tab-1">
            <p className="text-sm text-muted p-4">This is the overview tab content.</p>
          </TabsContent>
          <TabsContent value="tab-2">
            <p className="text-sm text-muted p-4">This is the settings tab content.</p>
          </TabsContent>
          <TabsContent value="tab-3">
            <p className="text-sm text-muted p-4">This is the logs tab content.</p>
          </TabsContent>
        </Tabs>
      ),
      code: `<Tabs defaultValue="tab-1">
  <TabsList>
    <TabsTrigger value="tab-1">Overview</TabsTrigger>
    <TabsTrigger value="tab-2">Settings</TabsTrigger>
    <TabsTrigger value="tab-3">Logs</TabsTrigger>
  </TabsList>
  <TabsContent value="tab-1">
    <p>This is the overview tab content.</p>
  </TabsContent>
  <TabsContent value="tab-2">
    <p>This is the settings tab content.</p>
  </TabsContent>
  <TabsContent value="tab-3">
    <p>This is the logs tab content.</p>
  </TabsContent>
</Tabs>`,
    },
  ],
}
