import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const cardMeta: ComponentMeta = {
  slug: "card",
  name: "Card",
  description: "A container with header, content, and footer sections.",
  category: "Data Display",
  source: "components/card.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>Card Title</CardTitle>
              <CardDescription>Card description with supporting text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">
                This is the main content area of the card. You can place any content here.
              </p>
            </CardContent>
            <CardFooter>
              <Button variant="outline">Cancel</Button>
              <Button>Save</Button>
            </CardFooter>
          </Card>
        </div>
      ),
      code: `<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description with supporting text.</CardDescription>
  </CardHeader>
  <CardContent>
    <p>This is the main content area of the card.</p>
  </CardContent>
  <CardFooter>
    <Button variant="outline">Cancel</Button>
    <Button>Save</Button>
  </CardFooter>
</Card>`,
    },
  ],
}
