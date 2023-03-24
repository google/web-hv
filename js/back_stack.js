var backStack = (function() {

    $(function() {

        // Check url hash
        const urlParams = new URLSearchParams(window.location.search);
        let base = window.location.origin + window.location.pathname;
        if (urlParams.get("mode") == "mirror") {
            // Switch to mirror mode
            $("#main-title-wrapper").html("<h2>Mirror android screen</h2>");
            activityListAction = deviceMirrorAction;
            base += "?mode=mirror";
        }

        history.replaceState({}, "", base);
    });

    var cbStack = [];

    window.onpopstate = function(event) {
        cbStack.pop();
        if (cbStack.length > 0) {
            let last = cbStack[cbStack.length - 1];
            if (last[0] == event.state.url) {
                console.log("Found");
                last[1]();
                return;
            }
        }
        location.reload();
    }

    return {

        add: function(url, callback) {
            cbStack.push([url, callback]);
            history.pushState({url: url}, "", url);
        }
    };
})();