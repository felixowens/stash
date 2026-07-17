import React from "react";
import { Route, Switch } from "react-router-dom";
import { Helmet } from "react-helmet";
import { useTitleProps } from "src/hooks/title";
import { FilteredClipList } from "./ClipList";
import Clip from "./ClipDetails/Clip";
import { ClipFeed } from "./ClipFeed";
import { View } from "../List/views";

const Clips: React.FC = () => {
  return <FilteredClipList view={View.Clips} alterQuery />;
};

const ClipRoutes: React.FC = () => {
  const titleProps = useTitleProps({ id: "clips" });
  return (
    <>
      <Helmet {...titleProps} />
      <Switch>
        <Route exact path="/clips" component={Clips} />
        <Route exact path="/clips/feed" component={ClipFeed} />
        <Route path="/clips/:id" component={Clip} />
      </Switch>
    </>
  );
};

export default ClipRoutes;
